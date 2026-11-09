/**
 * Respuesta a una interconsulta (PAPER §28, feedback de las dermatólogas 2026-11-09).
 *
 * Lo que responde el especialista tiene que quedar en la ficha y en la evolución, no
 * solo en el chat, y la campana de "revisar" se tiene que apagar al responder. Este
 * módulo arma el lote de herramientas que hace las tres cosas; lo usan el comando
 * `responder <texto>` (con el gate de confirmación, porque se infiere de texto libre) y
 * el formulario «Responder interconsulta» (directo: es una acción explícita).
 */

export interface InterconsultaAnswer {
  episodeId: string;
  /** Quien responde. */
  userId: string | null;
  /** El médico que envió el caso: recibe el aviso. */
  primarioId?: string | null;
  /** Indicaciones / respuesta del especialista. Obligatoria. */
  recomendacion: string;
  diagnostico?: string | null;
  tratamiento?: string | null;
  observaciones?: string | null;
  /** Prioridad clínica (PAPER §34): la decide el médico responsable. */
  prioridad?: string | null;
  /** Fecha de hoy (YYYY-MM-DD); se inyecta para los tests. */
  today?: string;
}

export interface BatchStep { tool: string; args: Record<string, unknown> }

/** Estados en los que el caso espera la respuesta de un especialista. */
export const ESTADOS_CON_INTERCONSULTA = ['enviada', 'en_triage', 'derivada', 'en_revisión_solicitada'];

const limpio = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Las de PAPER §34 (mismo orden que la ficha). */
export const PRIORIDADES_VALIDAS = ['Urgente', 'Preferente', 'Programada'];

export function buildAnswerBatch(a: InterconsultaAnswer): BatchStep[] {
  const recomendacion = limpio(a.recomendacion);
  if (!recomendacion) throw new Error('falta la respuesta del especialista');
  const today = a.today || new Date().toISOString().slice(0, 10);

  // Solo se escribe lo que vino: un campo vacío no borra lo que la ficha ya tenía.
  const data: Record<string, unknown> = {
    recomendacion, recomendacion_por: a.userId, recomendacion_at: today, estado: 'respondida',
  };
  const diagnostico = limpio(a.diagnostico);
  const tratamiento = limpio(a.tratamiento);
  const observaciones = limpio(a.observaciones);
  if (diagnostico) data.diagnostico = diagnostico;
  if (tratamiento) data.tratamiento_resumen = tratamiento;
  if (observaciones) data.observaciones = observaciones;
  const prioridad = limpio(a.prioridad);
  if (prioridad && PRIORIDADES_VALIDAS.includes(prioridad)) data.prioridad = prioridad;

  const batch: BatchStep[] = [
    { tool: 'entities.update', args: { id: a.episodeId, record_type: 'business', data } },
    // Apaga la campana de todos los revisores del caso (TodoERP complete_review).
    { tool: 'entities.complete_review', args: { entity_id: a.episodeId, result: 'Interconsulta respondida' } },
  ];
  if (a.primarioId) {
    // Contenido clínico, no PII (§13.3.1).
    const partes = [diagnostico && `Diagnóstico: ${diagnostico}`, tratamiento && `Tratamiento: ${tratamiento}`, recomendacion]
      .filter(Boolean);
    batch.push({ tool: 'reminders.create', args: {
      entity_id: a.episodeId, owner_user_id: a.primarioId,
      title: 'Respuesta a tu teleconsulta',
      message: partes.join('\n'),
      due_at: new Date().toISOString(),
      channels: ['in_app', 'email', 'telegram', 'web_push'],
    } });
  }
  return batch;
}

/**
 * Si `userId` puede responder la consulta: cuando espera especialista (estado pendiente) o
 * cuando es su RESPONSABLE (el de turno que recibió el paciente nuevo, PAPER §32), en
 * cualquier estado salvo ya respondida o cerrada.
 */
export function canAnswer(ep: { estado?: string | null; responsable_actual_id?: string | null }, userId: string | null): boolean {
  const estado = ep.estado || '';
  if (ESTADOS_CON_INTERCONSULTA.includes(estado)) return true;
  if (estado === 'respondida' || estado === 'cerrado') return false;
  return !!userId && !!ep.responsable_actual_id && ep.responsable_actual_id === userId;
}
