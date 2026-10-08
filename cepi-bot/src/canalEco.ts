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
  /** Lo marca el hilo: dato que alguien envió, no maniobra de su conversación con el bot. */
  contenido?: boolean;
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
 * Lo que le falta ver a un chat: **contenido** de OTRAS sesiones, posterior a
 * `desde` y todavía no enviado. Lo de su propia sesión ya lo tiene en pantalla.
 *
 * Solo contenido: lo que una persona envió como dato. Las preguntas y
 * respuestas del bot son de la conversación de quien las recibió —reenviarlas
 * sería hacerle a un tercero una pregunta que no era para él—, y un eco nunca
 * provoca una respuesta del bot.
 */
export function mensajesNuevos(
  messages: MensajeDeHilo[], sesionPropia: string | undefined, desde: number, enviados: Set<string>,
): MensajeDeHilo[] {
  return messages.filter(m =>
    m.session_id !== sesionPropia
    && !!m.ts && new Date(m.ts).getTime() > desde
    && !enviados.has(claveDeMensaje(m))
    && !!(m.content || '').trim()
    && !m.is_bot && m.contenido === true);
}

/** Texto de un mensaje del hilo para un canal: quién lo escribió y qué. */
export function textoDeEco(m: MensajeDeHilo): string {
  return `💬 *${m.self ? 'Tú (otro dispositivo)' : (m.author_name || 'Profesional')}*\n${m.content}`;
}

// ── El eco de un canal ──────────────────────────────────────────────────────

/** Lo que un canal le presta al eco: de quién es cada chat y cómo escribirle. */
export interface TransporteDeEco<K> {
  /** Sesión propia del chat: sus mensajes ya los tiene en pantalla y no se le reenvían. */
  sesionDe(k: K): string | undefined;
  jwtDe(k: K): string | undefined;
  /** El JWT del chat venció: pedir otro. `null` si ya no tiene acceso. */
  renovarJwt(k: K): Promise<string | null>;
  /** ¿Sigue vigente el paciente activo de ese chat? (inactividad, ventana del proveedor) */
  vigente(k: K): boolean;
  enviar(k: K, texto: string): Promise<void>;
  /** La cola del chat, para no cruzarse con un turno suyo en curso. */
  enCola(k: K, tarea: () => Promise<void>): Promise<void>;
}

export interface EcoDeCanal<K> {
  /** Ese chat tiene activo a este paciente. Si es otro que antes, el eco arranca desde ahora. */
  fijar(k: K, patientId: string): void;
  /** Soltó o cambió de paciente: deja de recibir ese hilo. */
  soltar(k: K): void;
  pacienteDe(k: K): string | undefined;
  /** Foto del estado para guardarlo, y su restauración tras un reinicio. */
  exportar(): Array<[K, { patientId: string; desde: number; enviados: string[] }]>;
  importar(datos: Array<[K, { patientId: string; desde: number; enviados: string[] }]>): void;
}

interface EstadoDeEco { patientId: string; desde: number; enviados: Set<string>; }

/**
 * Suscribe un canal al eco. Cuando termina un turno sobre un paciente, a cada
 * chat que lo tiene activo —salvo al que lo escribió— se le manda lo que le
 * falta ver, leído con su propio JWT.
 */
export function crearEco<K>(canal: string, t: TransporteDeEco<K>): EcoDeCanal<K> {
  const estados = new Map<K, EstadoDeEco>();

  const ponerAlDia = async (k: K): Promise<void> => {
    const estado = estados.get(k);
    if (!estado || !t.vigente(k)) return;
    try {
      // Tras un reinicio el chat no tiene JWT en memoria: se pide uno.
      let jwt = t.jwtDe(k) || await t.renovarJwt(k);
      if (!jwt) return;
      let hilo = await leerHilo(jwt, estado.patientId);
      if (hilo.status === 401) {
        const nuevo = await t.renovarJwt(k);
        if (!nuevo) return;
        jwt = nuevo;
        hilo = await leerHilo(jwt, estado.patientId);
      }
      if (hilo.status !== 200) { console.error(`[${canal}] eco: hilo ${hilo.status}`); return; }
      for (const m of mensajesNuevos(hilo.messages, t.sesionDe(k), estado.desde, estado.enviados)) {
        if (estados.get(k) !== estado) return;        // cambió de paciente mientras tanto
        await t.enviar(k, textoDeEco(m));
        estado.enviados.add(claveDeMensaje(m));
      }
    } catch (e: any) {
      console.error(`[${canal}] eco:`, e?.message || e);
    }
  };

  alTurnoDePaciente(({ patientId, sessionId }) => {
    for (const [k, estado] of estados) {
      if (estado.patientId !== patientId || t.sesionDe(k) === sessionId) continue;
      void t.enCola(k, () => ponerAlDia(k));
    }
  });

  return {
    fijar(k, patientId) {
      if (estados.get(k)?.patientId === patientId) return;
      estados.set(k, { patientId, desde: Date.now(), enviados: new Set() });
    },
    soltar(k) { estados.delete(k); },
    pacienteDe(k) { return estados.get(k)?.patientId; },
    exportar() { return [...estados].map(([k, e]) => [k, { patientId: e.patientId, desde: e.desde, enviados: [...e.enviados] }]); },
    importar(datos) {
      for (const [k, e] of datos || []) {
        if (e?.patientId) estados.set(k, { patientId: e.patientId, desde: e.desde || Date.now(), enviados: new Set(e.enviados || []) });
      }
    },
  };
}
