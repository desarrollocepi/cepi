/**
 * Galería de imágenes clínicas (PAPER §24.2.1, D-Aux-22).
 *
 * Dos pantallas, una consulta: las imágenes de TODOS los casos de la organización
 * activa (con buscador) y las de UN paciente, de todas sus consultas. Lo que se ve
 * de cada foto es lo justo para reconocer el caso sin abrirlo: paciente, cédula,
 * fecha de la consulta, diagnóstico y CIE-10.
 *
 * **Sin N+1.** `entity_clinical_image` ya trae `patient_id` y `episode_id`, así que
 * la página se resuelve en 3 consultas fijas (imágenes + los pacientes de la página
 * + los episodios de la página) y 2 más cuando hay búsqueda, sin importar cuántas
 * fotos tenga la página. Lo clínico se arma acá; TodoERP solo sabe de columnas.
 *
 * **Organización.** Todo sale de `GET /api/entities` con el JWT del caller, que ya
 * filtra por la org activa (D-Aux-21): sin org activa no se ve ningún paciente, y
 * nunca aparece nada de otra org ni de una sandbox. Esta capa no puede ampliarlo.
 *
 * **PII.** `nombre` y `cedula` están marcados `pii: true`: a un rol sin
 * `pii:read:patient` el ERP se los devuelve redactados y acá se pasan tal cual.
 */
import type { ErpClient } from './erp.js';

export const CLINICAL_IMAGE_ENTITY_ID = '16000000-0000-0000-0000-000000000000';
export const PATIENT_ENTITY_ID = '11000000-0000-0000-0000-000000000000';
export const EPISODE_ENTITY_ID = '12000000-0000-0000-0000-000000000000';

/** Página por defecto y tope de la galería. */
export const LIMITE_DEFAULT = 60;
export const LIMITE_MAX = 200;

/**
 * Cuántos pacientes / episodios puede abarcar UNA búsqueda. Los ids viajan en la
 * URL de la consulta al ERP, así que la lista no puede crecer sin límite. Con más
 * coincidencias que esto se toman las más recientes; para el dato real de CEPI
 * (cientos de pacientes) no se llega nunca.
 */
export const TOPE_COINCIDENCIAS = 200;

/** Los campos en los que busca `q`, por entidad (PAPER §24.2.1). */
export const CAMPOS_BUSQUEDA_PACIENTE = ['title', 'nombre', 'apellidos', 'cedula'];
export const CAMPOS_BUSQUEDA_EPISODIO = ['diagnostico', 'codigo_cie10', 'fecha'];

export interface ImagenGaleria {
  id: string;
  attachment_id: string | null;
  patient_id: string | null;
  paciente: string | null;
  cedula: string | null;
  episode_id: string | null;
  fecha: string | null;
  diagnostico: string | null;
  codigo_cie10: string | null;
  body_region: string | null;
  privada: boolean;
}

export interface OpcionesGaleria {
  q?: string;
  patientId?: string;
  limit?: number;
  offset?: number;
}

/** Los campos de una fila de `/api/entities`: columnas materializadas + `data`. */
function campo(fila: any, clave: string): any {
  const v = fila?.[clave];
  if (v !== undefined && v !== null) return v;
  return fila?.data?.[clave] ?? null;
}

function texto(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** `fecha` llega como 'YYYY-MM-DD' o como ISO completo (columna DATE): se recorta. */
function soloFecha(v: any): string | null {
  const s = texto(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

/** "Nombre Apellidos". Si el ERP redactó la PII, los dos lados son `<REDACTED>`. */
export function nombreCompleto(nombre: any, apellidos: any): string | null {
  const n = texto(nombre);
  const a = texto(apellidos);
  if (n && a) return n === a ? n : `${n} ${a}`;
  return n || a;
}

/** Una consulta por lote de ids (nunca una por fila): el antídoto del N+1. */
async function porIds(erp: ErpClient, type: string, ids: string[]): Promise<Map<string, any>> {
  const mapa = new Map<string, any>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return mapa;
  const { data } = await erp.listar({ type, ids: unicos.join(','), limit: unicos.length });
  for (const fila of data) mapa.set(String(fila.id), fila);
  return mapa;
}

/** Los ids que matchean `q` en una entidad, buscando SOLO en `campos`. */
async function idsQueMatchean(erp: ErpClient, type: string, q: string, campos: string[]): Promise<string[]> {
  const { data } = await erp.listar({
    type, q, q_fields: campos.join(','), limit: TOPE_COINCIDENCIAS,
  });
  return data.map((f: any) => String(f.id));
}

/**
 * Una página de la galería. `q` busca por nombre del paciente, cédula, diagnóstico,
 * CIE-10 y fecha (prefijo YYYY-MM-DD); `patientId` la acota a un paciente. Sin
 * ninguno de los dos, las imágenes más recientes primero.
 */
export async function listarGaleria(
  erp: ErpClient, opts: OpcionesGaleria = {},
): Promise<{ data: ImagenGaleria[]; total: number }> {
  const limit = Math.min(Math.max(Number(opts.limit) || LIMITE_DEFAULT, 1), LIMITE_MAX);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const q = (opts.q || '').trim();

  const params: Record<string, string | number | undefined> = {
    type: CLINICAL_IMAGE_ENTITY_ID,
    limit, offset, with_total: 1,
    // D-Aux-23: el borrado del paciente es suave, así que sus imágenes siguen
    // activas. La galería no las muestra igual: una foto no cuelga de un paciente
    // (ni de una consulta) que ya no está. Va en la consulta, no en el filtrado
    // posterior, para que `total` y el paginado sigan cuadrando.
    'filter[patient_id][active]': 1,
    'filter[episode_id][active]': 1,
  };
  // Forma larga `[eq]`: la columna ya lleva `[active]`, y `filter[x]=1` junto a
  // `filter[x][op]=…` son dos formas incompatibles de la misma clave.
  if (opts.patientId) params['filter[patient_id][eq]'] = opts.patientId;

  // Pacientes y episodios se buscan por separado y la imagen entra si cae en
  // cualquiera de los dos conjuntos: `filter_or` es justo ese OR. Los episodios de
  // un paciente que matchea NO hacen falta — sus imágenes ya entran por patient_id.
  if (q) {
    const [pacientes, episodios] = await Promise.all([
      idsQueMatchean(erp, PATIENT_ENTITY_ID, q, CAMPOS_BUSQUEDA_PACIENTE),
      idsQueMatchean(erp, EPISODE_ENTITY_ID, q, CAMPOS_BUSQUEDA_EPISODIO),
    ]);
    // Nada matchea: no hace falta preguntar por las imágenes.
    if (pacientes.length === 0 && episodios.length === 0) return { data: [], total: 0 };
    if (pacientes.length > 0) params['filter_or[patient_id][in]'] = pacientes.join(',');
    if (episodios.length > 0) params['filter_or[episode_id][in]'] = episodios.join(',');
  }

  const pagina = await erp.listar(params);
  const imagenes = pagina.data;
  if (imagenes.length === 0) return { data: [], total: pagina.total ?? 0 };

  const [pacientes, episodios] = await Promise.all([
    porIds(erp, PATIENT_ENTITY_ID, imagenes.map((i: any) => String(campo(i, 'patient_id') || ''))),
    porIds(erp, EPISODE_ENTITY_ID, imagenes.map((i: any) => String(campo(i, 'episode_id') || ''))),
  ]);

  const data = imagenes.map((img: any): ImagenGaleria => {
    const patientId = texto(campo(img, 'patient_id'));
    const episodeId = texto(campo(img, 'episode_id'));
    const p = patientId ? pacientes.get(patientId) : null;
    const e = episodeId ? episodios.get(episodeId) : null;
    return {
      id: String(img.id),
      attachment_id: texto(campo(img, 'attachment_id')),
      patient_id: patientId,
      paciente: p ? nombreCompleto(campo(p, 'nombre'), campo(p, 'apellidos')) : null,
      cedula: p ? texto(campo(p, 'cedula')) : null,
      episode_id: episodeId,
      fecha: e ? soloFecha(campo(e, 'fecha')) : null,
      diagnostico: e ? texto(campo(e, 'diagnostico')) : null,
      codigo_cie10: e ? texto(campo(e, 'codigo_cie10')) : null,
      body_region: texto(campo(img, 'body_region')),
      privada: campo(img, 'privada') === true,
    };
  });

  return { data, total: pagina.total ?? data.length };
}
