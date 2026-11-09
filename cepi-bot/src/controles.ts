/**
 * Próximos controles de los pacientes (PAPER §33).
 *
 * El control pendiente de un paciente es el de su consulta MÁS RECIENTE: si después
 * hubo otra consulta, el control viejo ya pasó o lo reemplazó el de la nueva. Todo sale
 * de `GET /api/entities` con el JWT del caller, así que el alcance por organización y la
 * PII los pone TodoERP. Sin N+1: cuatro consultas por lote, sin importar cuántas filas.
 */
import type { ErpClient } from './erp.js';
import { EPISODE_ENTITY_ID, PATIENT_ENTITY_ID, nombreCompleto } from './galeria.js';

const USER_ENTITY_ID = 'e1000000-0000-0000-0000-000000000000';
export const DIAS_ATRAS = 30;
export const DIAS_ADELANTE = 90;
const TOPE = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EstadoControl = 'atrasado' | 'hoy' | 'proximo';

export interface Control {
  episode_id: string;
  patient_id: string | null;
  paciente: string | null;
  cedula: string | null;
  fecha_control: string;
  motivo: string | null;
  plan: string | null;
  diagnostico: string | null;
  fecha_consulta: string | null;
  medico: string | null;
  estado_control: EstadoControl;
}

/** 'YYYY-MM-DD' de hoy en Ecuador (la misma zona que los turnos, PAPER §32). */
export function hoyEcuador(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.SHIFTS_TIMEZONE || 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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
function soloFecha(v: any): string | null {
  const s = texto(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

export function estadoDe(fecha: string, hoy: string): EstadoControl {
  return fecha < hoy ? 'atrasado' : fecha === hoy ? 'hoy' : 'proximo';
}

/** Clave para ordenar consultas de un paciente: la más reciente es la mayor. */
function claveConsulta(e: any): string {
  return `${soloFecha(campo(e, 'fecha')) || ''}|${String(campo(e, 'created_at') || '')}`;
}

/** Por paciente, el id de su consulta más reciente. */
export function ultimaConsultaPorPaciente(episodios: any[]): Map<string, string> {
  const mejor = new Map<string, { id: string; clave: string }>();
  for (const e of episodios) {
    const pid = texto(campo(e, 'patient_id'));
    if (!pid) continue;
    const clave = claveConsulta(e);
    const actual = mejor.get(pid);
    if (!actual || clave > actual.clave) mejor.set(pid, { id: String(e.id), clave });
  }
  return new Map([...mejor].map(([pid, v]) => [pid, v.id]));
}

async function porIds(erp: ErpClient, type: string, ids: string[]): Promise<Map<string, any>> {
  const mapa = new Map<string, any>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return mapa;
  const { data } = await erp.listar({ type, ids: unicos.join(','), limit: unicos.length });
  for (const f of data) mapa.set(String(f.id), f);
  return mapa;
}

export async function listarControles(
  erp: ErpClient, opts: { from?: string; to?: string; hoy?: string } = {},
): Promise<{ today: string; from: string; to: string; data: Control[] }> {
  const hoy = opts.hoy || hoyEcuador();
  const from = opts.from && DATE_RE.test(opts.from) ? opts.from : sumarDias(hoy, -DIAS_ATRAS);
  const to = opts.to && DATE_RE.test(opts.to) ? opts.to : sumarDias(hoy, DIAS_ADELANTE);

  // 1. Consultas con control en el rango, de pacientes que siguen activos.
  const { data: conControl } = await erp.listar({
    type: EPISODE_ENTITY_ID,
    'filter[proximo_control_fecha][gte]': from,
    'filter[proximo_control_fecha][lte]': to,
    'filter[patient_id][active]': 1,
    sort: 'proximo_control_fecha',
    limit: TOPE,
  });
  if (!conControl.length) return { today: hoy, from, to, data: [] };

  // 2. Todas las consultas de esos pacientes, para quedarse con la última de cada uno.
  const pacientesIds = [...new Set(conControl.map((e: any) => texto(campo(e, 'patient_id'))).filter(Boolean))] as string[];
  const { data: todas } = await erp.listar({
    type: EPISODE_ENTITY_ID, 'filter[patient_id][in]': pacientesIds.join(','), limit: TOPE * 4,
  });
  const ultima = ultimaConsultaPorPaciente([...todas, ...conControl]);
  const vigentes = conControl.filter((e: any) => ultima.get(String(campo(e, 'patient_id'))) === String(e.id));

  // 3. Pacientes y médicos por lote.
  // Los médicos son la entidad `user`, que no todos los roles pueden leer: sin permiso se
  // usa el nombre del examinador que guarda la consulta, en vez de tumbar el listado.
  const [pacientes, medicos] = await Promise.all([
    porIds(erp, PATIENT_ENTITY_ID, pacientesIds),
    porIds(erp, USER_ENTITY_ID, vigentes.map((e: any) =>
      String(campo(e, 'medico_id') || campo(e, 'created_by') || '')))
      .catch((err: any) => {
        if (err?.status === 401 || err?.status === 403) return new Map<string, any>();
        throw err;
      }),
  ]);

  const data = vigentes.map((e: any): Control => {
    const pid = texto(campo(e, 'patient_id'));
    const p = pid ? pacientes.get(pid) : null;
    const mid = String(campo(e, 'medico_id') || campo(e, 'created_by') || '');
    const m = mid ? medicos.get(mid) : null;
    const fecha = soloFecha(campo(e, 'proximo_control_fecha')) as string;
    return {
      episode_id: String(e.id),
      patient_id: pid,
      paciente: p ? nombreCompleto(campo(p, 'nombre'), campo(p, 'apellidos')) || texto(p.title) : null,
      cedula: p ? texto(campo(p, 'cedula')) : null,
      fecha_control: fecha,
      motivo: texto(campo(e, 'proximo_control_motivo')),
      plan: texto(campo(e, 'plan')),
      diagnostico: texto(campo(e, 'diagnostico')),
      fecha_consulta: soloFecha(campo(e, 'fecha')),
      medico: (m ? texto(campo(m, 'nombre')) || texto(m.title) : null) || texto(campo(e, 'examinador_nombre')),
      estado_control: estadoDe(fecha, hoy),
    };
  }).sort((a: Control, b: Control) => a.fecha_control.localeCompare(b.fecha_control)
    || String(a.paciente || '').localeCompare(String(b.paciente || '')));

  return { today: hoy, from, to, data };
}
