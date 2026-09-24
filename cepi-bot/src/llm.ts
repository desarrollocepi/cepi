/**
 * Pluggable LLM interface. The agent calls one of these to plan tool calls
 * and produce final answers; concrete adapters wrap DeepSeek (recommended
 * for v1 per PAPER §12.7), OpenAI, Claude, etc.
 *
 * For now we ship a `stub` adapter that returns canned responses so the
 * rest of the agent — MCP wiring, session persistence, role dispatch —
 * can be developed and tested without burning API credit.
 */

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** For role:'tool', the corresponding tool name. */
  tool_name?: string;
  /** ISO timestamp, stamped at persist time. Lets the patient group thread
   *  order messages chronologically across sessions (PAPER §11.5). */
  ts?: string;
  /** Active episode at persist time. Lets the UI group the thread per episode
   *  (navegación con flechas) aun si una sesión abarca varios episodios. */
  episode_id?: string | null;
}

export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema?: any;
}

export interface LLMResponse {
  /** Either an assistant message or a tool call instruction. */
  kind: 'message' | 'tool_call';
  /** Plain text answer when kind=message. */
  text?: string;
  /** Tool name + args when kind=tool_call. */
  tool?: { name: string; args: Record<string, unknown> };
}

export interface LLMAdapter {
  name: string;
  /** Single round-trip: given history+tools, return the next move. */
  step(history: ChatTurn[], tools: ToolSpec[]): Promise<LLMResponse>;
}

/**
 * Stub adapter — keyword routing. Useful for unit tests and as a safety
 * net when the real provider is unreachable.
 *
 * Recognized intents:
 *   "tools"  / "/tools"      → list available tools
 *   "whoami" / "/whoami"     → call auth.whoami
 *   "definitions" / "/defs"  → call definitions.list
 *   "patients" / "/patients" → call entities.list with patient slug
 *   anything else            → echo
 */
export class StubLLMAdapter implements LLMAdapter {
  name = 'stub';

  async step(history: ChatTurn[], tools: ToolSpec[]): Promise<LLMResponse> {
    // If the very last history entry is a tool result, summarise and stop —
    // never chain more than one tool call in stub mode. The frontend renders
    // the raw tool turn nicely, so keep this assistant message terse.
    const tail = history[history.length - 1];
    if (tail?.role === 'tool') {
      try {
        const data = JSON.parse(tail.content);
        if (Array.isArray(data)) {
          return {
            kind: 'message',
            text: `Listo. ${data.length} resultado${data.length === 1 ? '' : 's'} de \`${tail.tool_name}\` arriba.`,
          };
        }
        if (data?.error) {
          return { kind: 'message', text: `\`${tail.tool_name}\` devolvió error: ${data.error}` };
        }
        return { kind: 'message', text: `Resultado de \`${tail.tool_name}\` arriba.` };
      } catch {
        return { kind: 'message', text: `Resultado de \`${tail.tool_name}\` arriba.` };
      }
    }

    const last = [...history].reverse().find(t => t.role === 'user');
    const msg = (last?.content || '').toLowerCase().trim();
    const has = (...needles: string[]) => needles.some(n => msg.includes(n));

    // Attachment marker emitted by the frontend uploader: "[adjunto: name · uuid]".
    // For now we just acknowledge — wiring it to a clinical_image entity needs
    // an active episode, which the agent will manage in a later iteration.
    const attachMatch = (last?.content || '').match(/\[adjunto:\s*([^·]+)·\s*([0-9a-f-]{36})\s*\]/i);
    if (attachMatch) {
      const name = attachMatch[1].trim();
      const id   = attachMatch[2];
      return {
        kind: 'message',
        text: `Recibí el adjunto **${name}** (id: \`${id}\`). Cuando tengas un episodio activo, dime "guardar imagen en episodio <id>" y la enlazo como imagen clínica.`,
      };
    }

    if (has('/help', 'ayuda', 'comandos')) {
      return {
        kind: 'message',
        text: [
          'Comandos del bot CEPI:',
          '',
          '**Contexto**',
          '  activar paciente <uuid>   → fija el paciente activo de la sesión',
          '  activar episodio <uuid>   → fija el episodio activo',
          '  salir paciente | salir episodio',
          '',
          '**Flujos clínicos** (cada uno pide confirmación)',
          '  nuevo episodio <motivo>    → crea episodio para el paciente activo',
          '  cerrar episodio [YYYY-MM-DD] [motivo] → cierra episodio + reminder',
          '  diagnostico <CIE10> <descripción>  → crea diagnóstico presuntivo',
          '  signs PA=120/80 FC=70 T=36.5 …    → guarda signos vitales en el episodio',
          '  exportar [anonimizado]             → descarga JSON con paciente + episodios + dx + imágenes',
          '  /escalar a <user-uuid> <razón>     → escala episodio a colega',
          '  📎 (adjuntar imagen)        → crea clinical_image ligada al episodio',
          '  casos similares             → vectors.search sobre la última imagen del episodio',
          '  sugerir diagnostico         → lee classifications de la imagen y mapea a CIE-10',
          '  mostrar resultados imagen   → resultados de los modelos IA de las imágenes del episodio',
          '',
          '**Telemedicina** (red de derivación primario → turno → especialistas)',
          '  enviar caso [motivo]               → (primario) envía el episodio a la bandeja de turno',
          '  entrantes | turno                  → (turno) bandeja compartida de casos por triagear',
          '  reclamar [<uuid>]                  → (turno) toma un caso → en_triage',
          '  derivar a <destino>[, <destino>…] [motivo]  → deriva el caso a círculos (dermatologia) y/o personas (uuid), varios a la vez',
          '  responder <texto>                  → registra recomendación y notifica al primario',
          '',
          '**Chatter**',
          '  nota <texto>                       → agrega nota al episodio (o paciente si no hay episodio)',
          '  ver chatter                        → muestra feed de actividad',
          '',
          '**Recordatorios**',
          '  recordatorios | reminders          → lista pending',
          '  completar reminder <uuid> [nota]   → marca como done',
          '  cancelar reminder <uuid>           → marca como cancelled',
          '  snooze reminder <uuid> YYYY-MM-DD  → reprograma para esa fecha',
          '',
          '**Lectura rápida**',
          '  whoami | definitions | pacientes | episodios | diagnósticos',
          '  buscar paciente <texto>            → entities.list filtrado',
          '',
          '**Confirmación**',
          '  sí / ok / confirmar / adelante / yes',
          '  no / cancelar',
          '',
          'También tengo acceso a las tools genéricas del MCP de TodoERP. Escribe "tools" para verlas.',
        ].join('\n'),
      };
    }
    if (has('tools')) {
      return {
        kind: 'message',
        text: 'Tools MCP disponibles:\n' + tools.map(t => `- \`${t.name}\`: ${t.description || ''}`).join('\n'),
      };
    }
    if (has('whoami', '/whoami')) {
      return { kind: 'tool_call', tool: { name: 'auth.whoami', args: {} } };
    }
    if (has('definitions', '/defs', 'definiciones')) {
      return { kind: 'tool_call', tool: { name: 'definitions.list', args: {} } };
    }
    if (has('pacientes', 'patients', '/patients')) {
      // patient entity_definition has UUID prefix 11000000-...
      return { kind: 'tool_call', tool: { name: 'entities.list', args: { type: '11000000-0000-0000-0000-000000000000', limit: 20 } } };
    }
    const buscarPac = (last?.content || '').match(/^\s*\/?\s*buscar\s+paciente\s+(.+?)\s*$/i);
    if (buscarPac) {
      return { kind: 'tool_call', tool: { name: 'entities.list', args: {
        type: '11000000-0000-0000-0000-000000000000',
        search: buscarPac[1],
        limit: 10,
      } } };
    }
    if (has('episodios', 'episodes')) {
      return { kind: 'tool_call', tool: { name: 'entities.list', args: { type: '12000000-0000-0000-0000-000000000000', limit: 20 } } };
    }
    if (has('revisiones', 'bandeja', '/revisiones')) {
      return { kind: 'tool_call', tool: { name: 'entities.list', args: { type: '12000000-0000-0000-0000-000000000000', search: 'en_revisión_solicitada', limit: 50 } } };
    }
    if (has('recordatorios', '/recordatorios', 'reminders')) {
      return { kind: 'tool_call', tool: { name: 'reminders.list', args: { status: 'pending' } } };
    }
    if (has('completados') || /\/?recordatorios\s+done/i.test(msg)) {
      return { kind: 'tool_call', tool: { name: 'reminders.list', args: { status: 'done' } } };
    }
    if (has('diagnosticos', 'diagnósticos', 'diagnoses')) {
      return { kind: 'tool_call', tool: { name: 'entities.list', args: { type: '13000000-0000-0000-0000-000000000000', limit: 20 } } };
    }
    // "ver paciente" / "ver episodio" — uses the active context injected as
    // a system message earlier in this turn.
    const stateNote = history.find(t => t.role === 'system' && /paciente=([0-9a-f-]{36})/.test(t.content || ''));
    const epNote    = history.find(t => t.role === 'system' && /episodio=([0-9a-f-]{36})/.test(t.content || ''));
    if (has('ver paciente') || /^\s*\/?ver\s+paciente\s*$/i.test(msg)) {
      const m = stateNote?.content?.match(/paciente=([0-9a-f-]{36})/);
      const pid = m?.[1];
      if (pid) return { kind: 'tool_call', tool: { name: 'entities.get', args: { id: pid } } };
      return { kind: 'message', text: 'No hay paciente activo. Usa "activar paciente <uuid>" primero.' };
    }
    if (has('ver episodio') || /^\s*\/?ver\s+episodio\s*$/i.test(msg)) {
      const m = epNote?.content?.match(/episodio=([0-9a-f-]{36})/);
      const eid = m?.[1];
      if (eid) return { kind: 'tool_call', tool: { name: 'entities.get', args: { id: eid } } };
      return { kind: 'message', text: 'No hay episodio activo. Usa "activar episodio <uuid>" o "nuevo episodio …" primero.' };
    }

    return {
      kind: 'message',
      text: `Eco: "${last?.content || ''}". Sugerencias: "tools", "whoami", "definitions", "pacientes".`,
    };
  }
}

/** Async because real adapters live in side modules to keep tests fast. */
export async function getLLMAdapter(): Promise<LLMAdapter> {
  const provider = (process.env.CEPI_LLM_PROVIDER || 'stub').toLowerCase();
  if (provider === 'deepseek') {
    const mod = await import('./llmDeepSeek.js');
    return new mod.DeepSeekLLMAdapter();
  }
  if (provider === 'claude' || provider === 'claude-cli') {
    const mod = await import('./llmClaudeCli.js');
    return new mod.ClaudeCliLLMAdapter();
  }
  return new StubLLMAdapter();
}
