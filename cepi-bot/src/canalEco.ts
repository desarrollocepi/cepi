/**
 * Eco del hilo del paciente hacia los canales de chat (PAPER §27.8).
 *
 * El hilo de un paciente es uno solo, armado con las sesiones de todos los que
 * escribieron sobre él (`/api/patient-thread`). Quien tiene a ese paciente
 * activo en WhatsApp participa del mismo hilo: lo que escribe se ve en la web,
 * y lo que se escribe en la web le llega al teléfono mientras ese paciente siga
 * activo ahí.
 *
 * Todo turno pasa por el mismo proceso (`chatHandler`), venga de la web, de una
 * app o de un canal. Al terminar uno con paciente activo se avisa acá, y cada
 * canal decide a quién le toca. El aviso no lleva contenido: el canal vuelve a
 * leer el hilo **con el JWT de su usuario**, así que recibe exactamente lo que
 * esa persona vería en la web, con sus permisos y su organización.
 */

export interface TurnoDePaciente { patientId: string; sessionId: string; }
type Oyente = (ev: TurnoDePaciente) => void;

const oyentes: Oyente[] = [];

/** Un canal se anota para enterarse de los turnos con paciente activo. */
export function alTurnoDePaciente(fn: Oyente): void { oyentes.push(fn); }

/** Lo llama el cerebro al responder un turno. Nunca lanza: el eco es de mejor esfuerzo. */
export function emitirTurnoDePaciente(ev: TurnoDePaciente): void {
  for (const fn of oyentes) {
    try { fn(ev); } catch (e: any) { console.error('[eco] oyente:', e?.message || e); }
  }
}

/** Un mensaje del hilo, como lo devuelve `/api/patient-thread`. */
export interface MensajeDeHilo {
  session_id: string; role: string; content: string;
  author_name?: string; self?: boolean; is_bot?: boolean; ts?: string;
}

/** Lee el hilo del paciente como lo ve el dueño de ese JWT. `status` 401 ⇒ token vencido. */
export async function leerHilo(jwt: string, patientId: string): Promise<{ status: number; messages: MensajeDeHilo[] }> {
  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  const r = await fetch(`${base}/api/patient-thread?patient_id=${encodeURIComponent(patientId)}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return { status: r.status, messages: [] };
  const data: any = await r.json().catch(() => ({}));
  return { status: 200, messages: Array.isArray(data?.messages) ? data.messages : [] };
}

/** Clave para no mandar dos veces el mismo mensaje. */
export function claveDeMensaje(m: MensajeDeHilo): string {
  return `${m.session_id}|${m.ts}|${m.role}|${(m.content || '').length}`;
}

/**
 * El acuse «Paciente activo: …» se emite cada vez que alguien abre al paciente
 * en la web. En el hilo de la web se muestra una sola vez; al teléfono no va.
 */
const ACUSE_DE_ACTIVACION = /^Paciente activo:/;

/**
 * Lo que le falta ver a un chat: mensajes de OTRAS sesiones, posteriores a
 * `desde` y todavía no enviados. Los de su propia sesión ya los tiene en pantalla.
 */
export function mensajesNuevos(
  messages: MensajeDeHilo[], sesionPropia: string | undefined, desde: number, enviados: Set<string>,
): MensajeDeHilo[] {
  return messages.filter(m =>
    m.session_id !== sesionPropia
    && !!m.ts && new Date(m.ts).getTime() > desde
    && !enviados.has(claveDeMensaje(m))
    && !!(m.content || '').trim()
    && !(m.is_bot && ACUSE_DE_ACTIVACION.test(m.content.trimStart())));
}

/** Texto de un mensaje del hilo para un canal: quién lo escribió y qué. */
export function textoDeEco(m: MensajeDeHilo): string {
  const quien = m.is_bot ? '🤖 *Asistente*' : `💬 *${m.self ? 'Tú (otro dispositivo)' : (m.author_name || 'Profesional')}*`;
  return `${quien}\n${m.content}`;
}
