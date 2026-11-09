/**
 * Alta del paciente (PAPER §35): el estado final del episodio.
 *
 * Dar de alta cierra el caso: `estado = alta`, la fecha y quién la dio, se apagan los
 * avisos de revisión pendientes y queda una nota en el chatter. Si el paciente vuelve,
 * se abre una consulta nueva con su propio motivo.
 */

export const ESTADO_ALTA = 'alta';

interface Step { tool: string; args: Record<string, unknown> }

/** 'YYYY-MM-DD' de hoy en Ecuador (la misma zona que turnos y controles). */
export function hoyEcuador(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.SHIFTS_TIMEZONE || 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Los pasos del alta. La nota es opcional; sin quien la da, no se firma. */
export function buildDischargeBatch(a: {
  episodeId: string; userId: string | null; userName?: string | null; nota?: string | null; today?: string;
}): Step[] {
  const nota = typeof a.nota === 'string' ? a.nota.trim() : '';
  const quien = a.userName?.trim() || 'el médico';
  return [
    {
      tool: 'entities.update',
      args: {
        id: a.episodeId, record_type: 'business',
        data: { estado: ESTADO_ALTA, alta_at: a.today || hoyEcuador(), ...(a.userId ? { alta_por: a.userId } : {}) },
      },
    },
    { tool: 'entities.complete_review', args: { entity_id: a.episodeId, result: 'Paciente dado de alta' } },
    {
      tool: 'chatter.add_note',
      args: { entity_id: a.episodeId, body: `🏁 Alta dada por ${quien}.${nota ? ` ${nota}` : ''}` },
    },
  ];
}

/** Por qué no se puede dar de alta, o null si se puede. */
export function dischargeBlockReason(ep: { estado?: string | null } | null | undefined): string | null {
  if (!ep) return 'No se encontró la consulta';
  if (ep.estado === ESTADO_ALTA) return 'Este paciente ya está de alta';
  return null;
}
