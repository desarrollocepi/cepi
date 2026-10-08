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
