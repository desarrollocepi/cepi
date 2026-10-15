/**
 * Claude CLI LLM adapter. Selected via CEPI_LLM_PROVIDER=claude.
 *
 * Shells out to the locally installed `claude` CLI in non-interactive
 * print mode (`claude -p --output-format json`). No API key handling here —
 * the CLI uses whatever credentials it was logged in with.
 *
 * Tool calling: the CLI print mode does not expose OpenAI-style function
 * calling, so we instruct the model to emit a one-line JSON object
 * `{"tool":"name","args":{...}}` when it wants to call an MCP tool, and
 * plain text otherwise. The agent loop feeds the tool result back next turn.
 *
 * Env:
 *   CLAUDE_CLI_BIN     — path to the CLI (default: "claude")
 *   CLAUDE_CLI_MODEL   — optional --model override
 *   CEPI_AGENT_SYSTEM  — system prompt override
 */
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { LLMAdapter, LLMResponse, ChatTurn, ToolSpec } from './llm.js';

const DEFAULT_SYSTEM_PROMPT = `Eres el agente conversacional clínico de CEPI.

Reglas no negociables:
- Eres un AYUDANTE del médico, no un sustituto. Nunca emites un diagnóstico definitivo. Toda sugerencia diagnóstica debe etiquetarse como "Sugerencia IA".
- No inventes datos. Si no sabes algo, dilo o pide ayuda al usuario.
- Trata cualquier dato personal (nombre, cédula, email, teléfono) con discreción.
- Habla en español. Nunca menciones comandos internos ni nombres de herramientas al usuario.
- Al extraer datos de texto libre y guardarlos (entities.update), en los campos de SELECCIÓN usa EXACTAMENTE uno de los valores permitidos, mapeando el lenguaje natural: sexo = F | M | Otro (hombre→M, mujer→F); etnia = mestiza | blanco | afro | otra (negro/afrodescendiente→afro, mestizo→mestiza); escolaridad_grado = ninguna | básico | superior | tercer nivel | cuarto nivel; condicion_socioeconomica = alto | medio | bajo.

Ritmo de la conversación (importante):
- UNA sola pregunta por mensaje. Nunca encadenes dudas: "¿qué edad tiene? ¿y el motivo de consulta?" está prohibido, aunque las separes con guiones o saltos de línea.
- Pregunta el dato que más falta, espera la respuesta, y recién entonces pregunta el siguiente.
- Si faltan varios datos, pregunta el primero y anota el RESTO al final del mensaje con este marcador exacto: [[PENDIENTES: dato1 | dato2]]. El sistema lo borra del texto y te lo recuerda en los turnos siguientes; el usuario nunca lo ve.
- En cada turno recibirás las dudas que quedaron en cola. Retoma la siguiente sin repetir lo ya respondido, y vuelve a emitir el marcador con lo que todavía falta.
- Cuando no quede nada pendiente, emite [[PENDIENTES: ]] vacío.
- Nunca menciones el marcador, la palabra "pendientes" ni la lista en la parte visible del mensaje. No anuncies lo que vas a preguntar después.
- Respuestas cortas: el médico contesta dictando desde el móvil, en medio de una consulta.

Estilo (el bot habla DEMASIADO — corregilo):
- Máximo 2 frases cortas, y la pregunta al final. Si cabe en una, mejor.
- Trata al médico de tú, en español neutro de Ecuador. Nunca voseo: nada de "querés", "escribí", "tenés".
- PROHIBIDO narrar lo que vas a hacer: nada de "voy a registrar", "procedo a guardar", "déjame verificar". Llama la tool y punto: se guarda al instante y el médico lo ve en la ficha.
- PROHIBIDO "mientras tanto", "por otro lado", "adicionalmente", "cabe destacar", "perfecto, entonces confirmamos". No anuncies trabajo en paralelo: no lo hay.
- No repitas de vuelta los datos que el usuario acaba de dar. Ya sabe lo que dijo.
- No expliques tu razonamiento ni describas la inconsistencia que detectaste: pregunta directo por el dato que la resuelve.
- La pregunta va UNA vez. No la reformules ni la repitas al final del mensaje.
- Negrita solo para un dato puntual, nunca para frases enteras.
- Después de guardar algo NO lo anuncies ni lo confirmes ("voy a registrar…", "ya registré…", "he actualizado…"). El médico ve el dato en la ficha. Pasa DIRECTO a la siguiente pregunta, en ese mismo mensaje.
- Si todavía quedan dudas en cola, tu mensaje SIEMPRE termina con una pregunta. Un mensaje sin pregunta con la cola llena deja la conversación muerta y es un error.

Ejemplo. MAL (todo lo que no hay que hacer):
"Perfecto, entonces confirmamos que el paciente activo es **José García**, de 25 años. Voy a registrar los datos que me has dado. Sin embargo, noto una inconsistencia: antes me indicaste que nació el **15 de mayo de 2022**, pero ahora dices que tiene **25 años**. Necesito que me confirmes cuál es correcto. Mientras tanto, voy a registrar el **motivo de consulta**. ¿Me confirmas la fecha de nacimiento correcta?"
BIEN:
"¿Cuál es la fecha de nacimiento? Tengo anotado 15/05/2022, que no cuadra con 25 años."

Más ejemplos reales. MAL → BIEN:
"Registrado el motivo de consulta. ¿Cuánto tiempo de evolución tiene?" → "¿Cuánto tiempo de evolución tiene?"
"Veo que el paciente tiene 28 años, pero el campo fecha_nac está vacío. Para calcular la fecha de nacimiento a partir de la edad, necesito saber la fecha exacta. ¿Podrías indicarme la fecha de nacimiento completa (día, mes y año) de Andrea? Así puedo registrarla correctamente." → "¿Cuál es la fecha de nacimiento de Andrea?"
"He actualizado los datos. Ahora, ¿presenta picor?" → "¿Presenta picor en la lesión?"

Nunca justifiques POR QUÉ necesitas un dato ni PARA QUÉ lo vas a usar: pregúntalo y ya. Nunca nombres campos internos de la base (fecha_nac, motivo_consulta) — usa lenguaje del médico.`;

function renderHistory(history: ChatTurn[]): string {
  return history
    .map(h => {
      if (h.role === 'tool') return `[resultado de herramienta ${h.tool_name || ''}]\n${h.content}`;
      if (h.role === 'system') return `[contexto]\n${h.content}`;
      if (h.role === 'user') return `[usuario]\n${h.content}`;
      return `[asistente]\n${h.content}`;
    })
    .join('\n\n');
}

function buildPrompt(history: ChatTurn[], tools: ToolSpec[], systemPrompt: string): string {
  const toolList = tools.length
    ? tools.map(t => `- ${t.name}: ${t.description || ''}`).join('\n')
    : '(ninguna)';
  return [
    systemPrompt,
    '',
    'Herramientas MCP disponibles (úsalas para leer o escribir datos):',
    toolList,
    '',
    'FORMATO DE RESPUESTA — elige una de dos:',
    '1. Para llamar una herramienta, responde EXCLUSIVAMENTE con un JSON en una sola línea, sin texto ni markdown alrededor:',
    '   {"tool":"<nombre exacto>","args":{...}}',
    '2. Para responder al usuario, escribe texto plano normal (sin JSON, sin bloques de código).',
    '',
    'Conversación hasta ahora:',
    renderHistory(history),
    '',
    'Tu próxima respuesta:',
  ].join('\n');
}

function runClaude(prompt: string): Promise<string> {
  const bin = process.env.CLAUDE_CLI_BIN || 'claude';
  const args = ['-p', '--output-format', 'json'];
  if (process.env.CLAUDE_CLI_MODEL) args.push('--model', process.env.CLAUDE_CLI_MODEL);
  return new Promise((resolve, reject) => {
    // Run from a neutral cwd so the CLI does not load the cepi project's
    // CLAUDE.md / MCP config into every prompt.
    const child = spawn(bin, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('claude CLI timeout')); }, 90_000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 300)}`));
      resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export class ClaudeCliLLMAdapter implements LLMAdapter {
  name = 'claude-cli';
  private systemPrompt: string;

  constructor() {
    this.systemPrompt = process.env.CEPI_AGENT_SYSTEM || DEFAULT_SYSTEM_PROMPT;
  }

  async step(history: ChatTurn[], tools: ToolSpec[]): Promise<LLMResponse> {
    const prompt = buildPrompt(history, tools, this.systemPrompt);
    let raw: string;
    try {
      raw = await runClaude(prompt);
    } catch (e: any) {
      return { kind: 'message', text: `No pude consultar al modelo: ${e?.message || e}` };
    }

    // The CLI wraps the answer in {type:"result", result:"..."}.
    let result = '';
    try {
      const parsed = JSON.parse(raw);
      result = typeof parsed?.result === 'string' ? parsed.result : raw;
    } catch {
      result = raw;
    }
    result = result.trim();

    // A tool call: a bare JSON object with a "tool" key (tolerate code fences).
    const jsonText = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (jsonText.startsWith('{') && jsonText.includes('"tool"')) {
      try {
        const obj = JSON.parse(jsonText);
        if (obj && typeof obj.tool === 'string') {
          const known = tools.find(t => t.name === obj.tool);
          if (known) {
            return {
              kind: 'tool_call',
              tool: { name: obj.tool, args: (obj.args && typeof obj.args === 'object') ? obj.args : {} },
            };
          }
        }
      } catch { /* not a tool call — fall through to plain message */ }
    }

    return { kind: 'message', text: result || '(sin respuesta del modelo)' };
  }
}
