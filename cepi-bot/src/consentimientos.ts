/**
 * Consentimientos del paciente (PAPER §31).
 *
 * Dos tipos con su propio lugar, separados de las fotos clínicas:
 *  - `informado`: el consentimiento informado, lo firma el paciente.
 *  - `privacidad_datos`: el de privacidad de los datos del paciente, lo firma el
 *    profesional que lo atiende.
 *
 * Cada foto subida es un registro `consent` del paciente. La foto va en
 * `attachment_id` (texto): el campo `documento` es de tipo attachment, no tiene
 * columna en la tabla tipada y el ERP lo descartaba al crear.
 *
 * Lo usan los grupos g_8 / g_8_2 de la ficha, la pregunta «¿qué es esta imagen?»
 * del chat y los endpoints /api/bot/consentimientos (web y apps).
 */

export const CONSENT_ENTITY_ID = '18000000-0000-0000-0000-000000000000';
const PATIENT_ENTITY_ID = '11000000-0000-0000-0000-000000000000';

export type ConsentType = 'informado' | 'privacidad_datos';
export const CONSENT_TYPES: ConsentType[] = ['informado', 'privacidad_datos'];

/** Tipo viejo con el que se guardaban las fotos de consentimiento antes de §31. */
const LEGACY_TYPE = 'imagen_clinica';

export const CONSENT_LABELS: Record<ConsentType, string> = {
  informado: 'consentimiento informado',
  privacidad_datos: 'consentimiento de privacidad de los datos',
};

export function isConsentType(v: unknown): v is ConsentType {
  return typeof v === 'string' && (CONSENT_TYPES as string[]).includes(v);
}

interface McpLike { call(tool: string, args: Record<string, unknown>): Promise<unknown> }

export interface ConsentRow {
  id: string;
  attachment_id: string | null;
  fecha: string | null;
  subido_por: string | null;
}

/** Datos de `entities.create` para una foto de consentimiento. */
export function buildConsentCreate(patientId: string, type: ConsentType, attachmentId: string, today?: string) {
  return {
    record_type: 'business',
    entity_id: CONSENT_ENTITY_ID,
    title: `consent_${type}_${attachmentId.slice(0, 8)}`,
    data: {
      [`${PATIENT_ENTITY_ID}:patient_id`]: patientId,
      tipo: type,
      version: 'foto-firmada',
      attachment_id: attachmentId,
      firmado_at: today || new Date().toISOString().slice(0, 10),
    },
  };
}

/** Crea un registro por foto. Devuelve los ids creados y los errores. */
export async function createConsents(
  mcp: McpLike, patientId: string, type: ConsentType, attachmentIds: string[],
): Promise<{ ids: string[]; errors: string[] }> {
  const ids: string[] = [];
  const errors: string[] = [];
  for (const aid of attachmentIds) {
    const r: any = await mcp.call('entities.create', buildConsentCreate(patientId, type, aid));
    if (r?.ok && typeof r?.data?.id === 'string') ids.push(r.data.id);
    else errors.push(r?.error || 'error desconocido');
  }
  return { ids, errors };
}

function field(row: any, key: string): any {
  const v = row?.[key];
  if (v !== undefined && v !== null) return v;
  return row?.data?.[key] ?? null;
}

function toRow(row: any): ConsentRow {
  const fecha = field(row, 'firmado_at') || field(row, 'created_at');
  return {
    id: String(row.id),
    attachment_id: field(row, 'attachment_id') || null,
    fecha: fecha ? String(fecha).slice(0, 10) : null,
    subido_por: field(row, 'created_by') || null,
  };
}

/**
 * Los consentimientos vigentes (sin revocar) de un paciente, por tipo y más nuevos
 * primero. Los registros viejos (`imagen_clinica`) cuentan como `informado`.
 */
export async function listConsents(mcp: McpLike, patientId: string): Promise<Record<ConsentType, ConsentRow[]>> {
  const r: any = await mcp.call('entities.list', {
    type: CONSENT_ENTITY_ID, filter: { patient_id: patientId }, limit: 200,
  });
  if (r?.ok === false) throw new Error(r?.error || 'no se pudieron leer los consentimientos');
  const rows: any[] = Array.isArray(r?.data) ? r.data : [];
  const out: Record<ConsentType, ConsentRow[]> = { informado: [], privacidad_datos: [] };
  for (const row of rows) {
    if (field(row, 'revocado_at')) continue;
    const t = field(row, 'tipo');
    const type: ConsentType | null = t === LEGACY_TYPE ? 'informado' : isConsentType(t) ? t : null;
    if (type) out[type].push(toRow(row));
  }
  for (const t of CONSENT_TYPES) out[t].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  return out;
}
