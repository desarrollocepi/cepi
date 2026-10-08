/**
 * Aviso de «pensando» de los canales de chat (WhatsApp, Telegram).
 *
 * Ninguno de los dos deja ponerle texto a su indicador de «escribiendo…», así
 * que el aviso son dos cosas: el indicador nativo, que no dice nada, y un
 * mensaje corto de verdad que sale ANTES de llamar al cerebro y nombra al
 * paciente con el que sigue la conversación. Ese mensaje es lo que evita
 * cargarle un dato al paciente equivocado: el médico lo lee mientras espera.
 *
 * Solo sale cuando el canal ya sabe qué paciente está activo, o sea desde la
 * segunda respuesta de una sesión. Sin paciente queda solo el indicador.
 */

/**
 * Nombre del paciente activo según la respuesta del cerebro, o '' si no hay.
 * Sale del `status_header` (`computeStatusHeader` en server.ts), que es
 * `👤 Nombre`, `👤 Nombre (consulta de información)` o `👤 Nombre — ficha §…`.
 */
export function pacienteDeRespuesta(body: any): string {
  if (!body?.active_patient_id) return '';
  const m = String(body?.status_header || '').match(/^👤\s*(.+?)(?:\s+—\s+|\s+\(|$)/);
  return m ? m[1].trim() : '';
}

/**
 * Mensajes que cambian o sueltan al paciente: decir «continuando con X» justo
 * antes de dejar a X sería mentir.
 */
const CAMBIA_DE_PACIENTE = /^\/?\s*(activar|salir|nuevo|buscar|paciente|cancelar|men[uú])(\s|-|$)/i;

/** Texto del aviso para este turno, o '' si no corresponde mandarlo. */
export function avisoContinuando(paciente: string | undefined, mensaje: string): string {
  const nombre = (paciente || '').trim();
  if (!nombre || CAMBIA_DE_PACIENTE.test(mensaje.trim())) return '';
  return `⏳ Continuando con ${nombre}…`;
}

// ── Ventana de gracia: cancelar antes de que el mensaje se procese ──────────
//
// El turno del cerebro no se puede abortar a mitad: escribe la sesión y la
// ficha en varios puntos y cortarlo deja estado a medias. Lo que sí se puede es
// NO empezarlo. El aviso lleva un botón «Cancelar» y el canal retiene el
// mensaje unos segundos; si el botón llega dentro de ese lapso, el mensaje
// nunca entra al cerebro. Pasado el lapso ya no hay nada que cancelar.

/** Textos de la ventana, iguales en los dos canales. */
export const TXT_CANCELAR = 'Cancelar';
export const TXT_CANCELADO = '🚫 Cancelado: no procesé tu mensaje.';
export const TXT_TARDE = 'Ese mensaje ya se procesó: no se pudo cancelar.';

/**
 * Duración de la ventana. `CEPI_CANAL_GRACIA_MS=0` la apaga: el aviso sale sin
 * botón y el turno no espera.
 */
export function graciaMs(): number {
  const n = Number(process.env.CEPI_CANAL_GRACIA_MS ?? 3000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** token → dueño (el chat que puede cancelarla) y cómo cerrarla. */
const ventanas = new Map<string, { dueno: string; cerrar: (sigue: boolean) => void }>();
let serie = 0;

/**
 * Abre una ventana para un turno. `espera` resuelve `true` cuando vence (el
 * turno sigue) o `false` si alguien la canceló antes. El token viaja en el
 * botón; una ventana por turno, así dos mensajes seguidos no se pisan.
 */
export function abrirGracia(dueno: string | number, ms: number): { token: string; espera: Promise<boolean> } {
  const token = `${Date.now().toString(36)}${(serie++).toString(36)}`;
  const espera = new Promise<boolean>(resolve => {
    const t = setTimeout(() => { ventanas.delete(token); resolve(true); }, ms);
    ventanas.set(token, {
      dueno: String(dueno),
      cerrar: sigue => { clearTimeout(t); ventanas.delete(token); resolve(sigue); },
    });
  });
  return { token, espera };
}

/**
 * Cancela la ventana si sigue abierta y es de ese chat. `false` ⇒ ya venció (o
 * el token no es suyo): el mensaje se procesó o se está procesando.
 */
export function cancelarGracia(token: string, dueno: string | number): boolean {
  const v = ventanas.get(token);
  if (!v || v.dueno !== String(dueno)) return false;
  v.cerrar(false);
  return true;
}

// ── Vigencia del paciente activo ────────────────────────────────────────────

/**
 * Cuánto dura «paciente activo» en un canal sin que la persona escriba. Pasado
 * ese rato el canal no da por hecho que sigue con el mismo: lo pregunta antes de
 * procesar el mensaje siguiente, y mientras tanto no le reenvía el hilo.
 * `CEPI_CANAL_INACTIVIDAD_MS`; por defecto 5 minutos.
 */
export function inactividadMs(): number {
  const n = Number(process.env.CEPI_CANAL_INACTIVIDAD_MS ?? 5 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
}
