/**
 * Evoluciones de la ficha (PAPER §28.4): una ficha (episodio) tiene varias citas.
 *
 * Agregar una evolución es una acción explícita del médico (sin gate). Pasos:
 *   1. Si la ficha todavía no tiene evoluciones, la primera cita se guarda como
 *      evolución `es_inicial` con lo que dice el episodio en ese momento. Así no se
 *      pierde cuando el episodio pasa a mostrar lo vigente.
 *   2. La evolución nueva, con `medico_id` = quien la registra.
 *   3. El episodio pasa a mostrar lo vigente: diagnóstico, tratamiento, observaciones y
 *      próximo control, solo lo que trae la evolución.
 *   4. Nota en el chatter del episodio.
 */
import { hoyEcuador, ESTADO_ALTA } from './alta.js';

export const EVOLUTION_ENTITY_ID = '1a000000-0000-0000-0000-000000000000';
const EPISODE_ENTITY_ID = '12000000-0000-0000-0000-000000000000';
const PATIENT_ENTITY_ID = '11000000-0000-0000-0000-000000000000';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type StepRole = 'initial' | 'evolution' | 'episode' | 'note';
export interface Step { tool: string; args: Record<string, unknown>; role: StepRole }

export interface EvolutionInput {
  fecha?: unknown;
  hallazgos?: unknown;
  diagnostico?: unknown;
  tratamiento?: unknown;
  observaciones?: unknown;
  proximo_control_fecha?: unknown;
  proximo_control_motivo?: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Diagnóstico con su código CIE-10 delante, sin repetirlo (igual que TodoERP, §28.1). */
export function diagnosisText(diagnostico: unknown, codigo: unknown): string | null {
  const d = text(diagnostico);
  const c = text(codigo);
  if (!c) return d || null;
  if (!d) return c;
  return d.toUpperCase().startsWith(c.toUpperCase()) ? d : `${c} — ${d}`;
}

/** Por qué no se puede agregar una evolución a esta ficha, o null si se puede. */
export function evolutionBlockReason(ep: { estado?: string | null } | null | undefined): string | null {
  if (!ep) return 'No se encontró la consulta';
  if (ep.estado === ESTADO_ALTA) return 'Esta ficha está de alta: abre una consulta nueva';
  return null;
}

/** Error de validación del cuerpo (400), o null. */
export function evolutionInputError(b: EvolutionInput): string | null {
  if (![b.hallazgos, b.diagnostico, b.tratamiento, b.observaciones].some((v) => text(v))) {
    return 'Escribe al menos hallazgos, diagnóstico, tratamiento u observaciones';
  }
  if (b.fecha != null && b.fecha !== '' && !DATE_RE.test(String(b.fecha))) return 'fecha debe ser YYYY-MM-DD';
  if (b.proximo_control_fecha != null && b.proximo_control_fecha !== '' && !DATE_RE.test(String(b.proximo_control_fecha))) {
    return 'proximo_control_fecha debe ser YYYY-MM-DD';
  }
  return null;
}

/** Solo las claves con valor: un vacío no se guarda ni pisa nada. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function dateOnly(v: unknown): string | null {
  const s = text(v);
  return s ? s.slice(0, 10) : null;
}

/**
 * Datos de la evolución inicial: la primera cita tal como la dice el episodio hoy.
 * `ep` son los campos del episodio; `createdBy`, quien lo creó (si no hay `medico_id`).
 */
export function buildInitialEvolution(a: {
  episodeId: string; patientId: string | null; ep: Record<string, any>; createdBy?: string | null;
}): Record<string, unknown> {
  const ep = a.ep || {};
  return {
    record_type: 'business',
    entity_id: EVOLUTION_ENTITY_ID,
    title: `evolucion_inicial_${a.episodeId.slice(0, 8)}`,
    data: compact({
      [`${EPISODE_ENTITY_ID}:episode_id`]: a.episodeId,
      ...(a.patientId ? { [`${PATIENT_ENTITY_ID}:patient_id`]: a.patientId } : {}),
      fecha: dateOnly(ep.fecha) || hoyEcuador(),
      medico_id: text(ep.medico_id) || a.createdBy || null,
      atendio_nombre: text(ep.examinador_nombre) || null,
      diagnostico: diagnosisText(ep.diagnostico, ep.codigo_cie10),
      tratamiento: text(ep.tratamiento_resumen) || text(ep.plan) || null,
      observaciones: text(ep.observaciones) || null,
      proximo_control_fecha: dateOnly(ep.proximo_control_fecha),
      proximo_control_motivo: text(ep.proximo_control_motivo) || null,
      es_inicial: true,
    }),
  };
}

/** Los pasos de agregar una evolución, en orden. */
export function buildAddEvolutionBatch(a: {
  episodeId: string;
  patientId: string | null;
  ep: Record<string, any>;
  episodeCreatedBy?: string | null;
  hasEvolutions: boolean;
  input: EvolutionInput;
  userId: string | null;
  userName?: string | null;
  today?: string;
}): Step[] {
  const fecha = text(a.input.fecha) || a.today || hoyEcuador();
  const traido = compact({
    hallazgos: a.input.hallazgos,
    diagnostico: a.input.diagnostico,
    tratamiento: a.input.tratamiento,
    observaciones: a.input.observaciones,
    proximo_control_fecha: a.input.proximo_control_fecha,
    proximo_control_motivo: a.input.proximo_control_motivo,
  });
  const steps: Step[] = [];
  if (!a.hasEvolutions) {
    steps.push({
      tool: 'entities.create', role: 'initial',
      args: buildInitialEvolution({ episodeId: a.episodeId, patientId: a.patientId, ep: a.ep, createdBy: a.episodeCreatedBy }),
    });
  }
  steps.push({
    tool: 'entities.create', role: 'evolution',
    args: {
      record_type: 'business',
      entity_id: EVOLUTION_ENTITY_ID,
      title: `evolucion_${fecha}_${a.episodeId.slice(0, 8)}`,
      data: {
        [`${EPISODE_ENTITY_ID}:episode_id`]: a.episodeId,
        ...(a.patientId ? { [`${PATIENT_ENTITY_ID}:patient_id`]: a.patientId } : {}),
        fecha,
        ...(a.userId ? { medico_id: a.userId } : {}),
        ...traido,
        es_inicial: false,
      },
    },
  });
  // La cabecera de la ficha muestra lo vigente (decisión del dueño): solo lo que trae.
  const vigente = compact({
    diagnostico: traido.diagnostico,
    tratamiento_resumen: traido.tratamiento,
    observaciones: traido.observaciones,
    proximo_control_fecha: traido.proximo_control_fecha,
    proximo_control_motivo: traido.proximo_control_motivo,
  });
  if (Object.keys(vigente).length) {
    steps.push({ tool: 'entities.update', role: 'episode', args: { id: a.episodeId, record_type: 'business', data: vigente } });
  }
  const quien = a.userName?.trim() || 'el médico';
  steps.push({
    tool: 'chatter.add_note', role: 'note',
    args: { entity_id: a.episodeId, body: `📝 Evolución del ${fecha} por ${quien}.` },
  });
  return steps;
}

/** Valor de un campo de un registro, sea columna plana o dentro de `data`. */
export function recordField(row: any, key: string): any {
  if (!row) return null;
  const v = row[key];
  if (v !== undefined && v !== null) return v;
  const d = row.data?.[key];
  if (d !== undefined && d !== null) return d;
  // Las relaciones viajan como `<def>:<campo>` dentro de data.
  const rel = Object.keys(row.data || {}).find((k) => k.endsWith(`:${key}`));
  return rel ? row.data[rel] : null;
}

/**
 * ¿Es `evolutionId` la evolución más reciente de su ficha? Lo es si ninguna otra tiene
 * fecha posterior (a igual fecha, la creada después). Editar sus observaciones también
 * actualiza las del episodio, que muestra lo vigente.
 */
export function isLatestEvolution(rows: any[], evolutionId: string): boolean {
  const key = (r: any) => `${String(recordField(r, 'fecha') || '').slice(0, 10)}|${recordField(r, 'created_at') || ''}`;
  const target = rows.find((r) => String(r?.id) === evolutionId);
  if (!target) return false;
  const k = key(target);
  return rows.every((r) => String(r?.id) === evolutionId || key(r) <= k);
}

/** Campos de una evolución que se editan desde su formulario (PAPER §28.4). */
export const EDITABLE_EVOLUTION_FIELDS = [
  'fecha', 'hallazgos', 'diagnostico', 'tratamiento', 'observaciones',
  'proximo_control_fecha', 'proximo_control_motivo',
] as const;

/**
 * Qué guardar al editar una evolución. Solo cambian las claves que trae el cuerpo; un
 * texto vacío borra ese campo (salvo la fecha, que no se puede dejar vacía). `vigente` es
 * lo que se copia al episodio si es la evolución más reciente: la cabecera de la ficha y
 * el bloque «Próximo control» muestran lo vigente, y cambiar la fecha del próximo control
 * en el episodio dispara el aviso de cita (§36).
 */
export function planEvolutionEdit(b: Record<string, unknown>, opts: { discharged?: boolean } = {}):
  { error: string } | { fields: Record<string, string | null>; vigente: Record<string, string | null> } {
  const fields: Record<string, string | null> = {};
  for (const k of EDITABLE_EVOLUTION_FIELDS) {
    if (!(k in b) || b[k] === undefined) continue;
    const v = b[k];
    if (v !== null && typeof v !== 'string') return { error: `${k} debe ser texto` };
    const t = typeof v === 'string' ? v.trim() : '';
    if ((k === 'fecha' || k === 'proximo_control_fecha') && t && !DATE_RE.test(t)) return { error: `${k} debe ser YYYY-MM-DD` };
    if (k === 'fecha' && !t) return { error: 'La fecha de la evolución no puede quedar vacía' };
    fields[k] = t || null;
  }
  if (!Object.keys(fields).length) return { error: 'No hay nada que guardar' };
  if (opts.discharged && fields.proximo_control_fecha) {
    return { error: 'Esta ficha está de alta: no lleva próximo control. Abre una consulta nueva' };
  }
  const vigente: Record<string, string | null> = {};
  if ('diagnostico' in fields) vigente.diagnostico = fields.diagnostico;
  if ('tratamiento' in fields) vigente.tratamiento_resumen = fields.tratamiento;
  if ('observaciones' in fields) vigente.observaciones = fields.observaciones;
  if ('proximo_control_fecha' in fields) vigente.proximo_control_fecha = fields.proximo_control_fecha;
  if ('proximo_control_motivo' in fields) vigente.proximo_control_motivo = fields.proximo_control_motivo;
  return { fields, vigente };
}
