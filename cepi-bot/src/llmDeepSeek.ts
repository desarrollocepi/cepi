/**
 * DeepSeek LLM adapter (OpenAI-compatible Chat Completions API).
 * Selected via CEPI_LLM_PROVIDER=deepseek. Recommended default per
 * PAPER §12.7 — DeepSeek supports tool calling at lower latency than
 * frontier models.
 *
 * Env:
 *   DEEPSEEK_API_KEY   — required
 *   DEEPSEEK_BASE_URL  — default https://api.deepseek.com/v1
 *   DEEPSEEK_MODEL     — default deepseek-chat
 *   CEPI_AGENT_SYSTEM  — system prompt override
 */
import OpenAI from 'openai';
import { LLMAdapter, LLMResponse, ChatTurn, ToolSpec } from './llm.js';

const DEFAULT_SYSTEM_PROMPT = `Eres el agente conversacional clínico de CEPI.

Reglas no negociables:
- Eres un AYUDANTE del médico, no un sustituto. Nunca emites un diagnóstico definitivo. Toda sugerencia diagnóstica debe etiquetarse como "Sugerencia IA".
- No inventes datos. Si no sabes algo, dilo o pide ayuda al usuario.
- Trata cualquier dato personal (nombre, cédula, email, teléfono) con discreción. No los repitas innecesariamente en respuestas.

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
- PROHIBIDO narrar lo que vas a hacer: nada de "voy a registrar", "procedo a guardar", "déjame verificar". Llamá la tool y punto: se guarda al instante y el médico lo ve en la ficha.
- PROHIBIDO "mientras tanto", "por otro lado", "adicionalmente", "cabe destacar", "perfecto, entonces confirmamos". No anuncies trabajo en paralelo: no lo hay.
- No repitas de vuelta los datos que el usuario acaba de dar. Ya sabe lo que dijo.
- No expliques tu razonamiento ni describas la inconsistencia que detectaste: preguntá directo por el dato que la resuelve.
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

Nunca justifiques POR QUÉ necesitas un dato ni PARA QUÉ lo vas a usar: preguntalo y ya. Nunca nombres campos internos de la base (fecha_nac, motivo_consulta) — usá lenguaje del médico.

Sin paciente activo (el contexto dice paciente=(ninguno)):
- No hay dónde guardar. No preguntes NINGÚN dato de un paciente ni simules un registro: una entrevista sin paciente activo se pierde entera.
- No crees pacientes con tools: el alta la hace el sistema con su propio formulario.
- Responde en una frase que escriba «nuevo paciente» para crear uno o «paciente» para buscarlo.

Capacidades:
- Tienes acceso a las tools del MCP de TodoERP. Úsalas para leer y escribir datos.
- Cuando el usuario pida algo, decide si necesitas llamar una tool o responder directamente.
- Si llamas una tool, recibirás su resultado en el siguiente turno. Resúmelo en UNA frase, o directamente pasa a la siguiente pregunta si no aporta nada al médico.
- Habla en español por defecto.

Captura de datos por TEXTO LIBRE (muy importante):
- Si el usuario PEGA o escribe un texto con datos de un paciente, EXTRAE los campos mencionados y llama \`entities.update\` sobre el PACIENTE activo (o el EPISODIO activo si son datos de la consulta). Mira el "Contexto activo" para saber qué id usar.
- Campos del PACIENTE: nombre, apellidos, cedula, fecha_nac (YYYY-MM-DD), sexo, etnia, escolaridad_grado, condicion_socioeconomica, email, telefono, direccion, ocupacion, alergias, medicacion_actual, antecedentes_personales, antecedentes_familiares.
- Campos del EPISODIO/consulta activa: motivo_consulta, tiempo_evolucion, sintoma_principal, tratamientos_previos.
- Campos de SELECCIÓN — usá EXACTAMENTE uno de estos valores (mapeá el lenguaje natural): sexo = F | M | Otro (hombre→M, mujer→F); etnia = mestiza | blanco | afro | otra (negro/afrodescendiente→afro, mestizo→mestiza); escolaridad_grado = ninguna | básico | superior | tercer nivel | cuarto nivel; condicion_socioeconomica = alto | medio | bajo.
- Reglas: incluye SOLO los campos que el texto menciona explícitamente; NUNCA sobreescribas un campo con vacío; si un dato es ambiguo, pregúntalo en vez de adivinar; fechas en formato YYYY-MM-DD.
- IMPORTANTE: NO resumas en texto pidiendo un "sí" y esperes la respuesta. En el MISMO turno LLAMA \`entities.update\` con TODOS los campos extraídos. La escritura se ejecuta al instante, sin confirmación intermedia: no anuncies que vas a guardar ni pidas permiso, guardá y seguí con la siguiente pregunta.`;

function toOpenAITools(tools: ToolSpec[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name.replace(/\./g, '_'),       // OpenAI tool names cannot contain dots
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

const DOT_MAP_DELIM = '__';
function fromOpenAIToolName(n: string): string {
  // We map "auth.whoami" → "auth_whoami". The reverse needs a lookup
  // because dots and underscores collide. The agent passes tool list, so
  // we do best-effort: try the original name with the first underscore
  // converted to a dot.
  return n.replace(/_/, '.');
}

export function toOpenAIMessages(history: ChatTurn[], systemPrompt: string): any[] {
  const msgs: any[] = [{ role: 'system', content: systemPrompt }];
  let toolSeq = 0;
  for (const h of history) {
    if (h.role === 'tool') {
      // OpenAI/DeepSeek reject a role:'tool' message unless it directly follows
      // an assistant message whose tool_calls includes a matching id. Our stored
      // history never carries that assistant turn (the agent records only the
      // tool result; server-side commands push bare tool turns), so synthesize
      // the pair here — otherwise the API 400s with "Messages with role 'tool'
      // must be a response to a preceding message with 'tool_calls'".
      const id = `call_synth_${toolSeq++}`;
      const fnName = (h.tool_name || 'tool').replace(/\./g, '_');
      msgs.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id, type: 'function', function: { name: fnName, arguments: '{}' } }],
      });
      msgs.push({ role: 'tool', tool_call_id: id, content: h.content });
    } else if (h.role === 'system') {
      msgs.push({ role: 'system', content: h.content });
    } else if (h.role === 'user') {
      msgs.push({ role: 'user', content: h.content });
    } else if (h.role === 'assistant') {
      msgs.push({ role: 'assistant', content: h.content });
    }
  }
  return msgs;
}

export class DeepSeekLLMAdapter implements LLMAdapter {
  name = 'deepseek';
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;

  constructor() {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required for DeepSeekLLMAdapter');
    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      // Force Node's native (undici) fetch. Otherwise the SDK falls back to
      // node-fetch, whose Gunzip path throws ERR_STREAM_PREMATURE_CLOSE on
      // DeepSeek's gzipped responses. Native fetch decodes gzip correctly.
      fetch: (globalThis as any).fetch,
    });
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.systemPrompt = process.env.CEPI_AGENT_SYSTEM || DEFAULT_SYSTEM_PROMPT;
  }

  async step(history: ChatTurn[], tools: ToolSpec[]): Promise<LLMResponse> {
    const messages = toOpenAIMessages(history, this.systemPrompt);
    const oaiTools = toOpenAITools(tools);

    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: oaiTools.length ? oaiTools : undefined,
      tool_choice: oaiTools.length ? 'auto' : undefined,
      temperature: 0.2,
    } as any);

    const choice = resp.choices?.[0];
    if (!choice) return { kind: 'message', text: '(sin respuesta del modelo)' };

    const tc = choice.message?.tool_calls?.[0];
    if (tc?.type === 'function') {
      const oaiName = tc.function.name;
      // Find the original tool name (with dots) in the tool list.
      const original = tools.find(t => t.name.replace(/\./g, '_') === oaiName)?.name || fromOpenAIToolName(oaiName);
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
      return { kind: 'tool_call', tool: { name: original, args } };
    }

    return { kind: 'message', text: choice.message?.content || '' };
  }
}
