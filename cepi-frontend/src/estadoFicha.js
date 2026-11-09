// El estado de la consulta más reciente del paciente (`estado` del episodio, que manda
// `GET /api/patient-assignments`). El orden de la tabla es el de la lista: del más avanzado
// en el circuito de telemedicina al menos avanzado, y al final lo cerrado y lo que no tiene
// consulta (PAPER §24.2.1). Mismos valores, etiquetas y colores que `EstadoFicha.swift` y
// `EstadoFicha.kt`.
export const ESTADOS_FICHA = [
  { id: 'respondida', valor: 'respondida', etiqueta: 'Respondida', color: '#16A34A' },
  { id: 'revision_solicitada', valor: 'en_revisión_solicitada', etiqueta: 'Revisión solicitada', color: '#DC2626' },
  { id: 'derivada', valor: 'derivada', etiqueta: 'Derivada', color: '#F59E0B' },
  { id: 'en_triaje', valor: 'en_triage', etiqueta: 'En triaje', color: '#06B6D4' },
  { id: 'enviada', valor: 'enviada', etiqueta: 'Enviada al turno', color: '#8B5CF6' },
  { id: 'en_curso', valor: 'en_curso', etiqueta: 'En curso', color: '#2563EB' },
  { id: 'agendada', valor: 'agendado', etiqueta: 'Agendada', color: '#64748B' },
  { id: 'cerrada', valor: 'cerrado', etiqueta: 'Cerrada', color: '#9CA3AF' },
  // Fin del caso (PAPER §35). Desde el día siguiente no sale en la lista salvo buscándolo.
  { id: 'alta', valor: 'alta', etiqueta: 'Alta', color: '#0F766E' },
  // Un valor que la app no conoce: se muestra, al final de los abiertos, sin inventarle sentido.
  { id: 'otro', valor: null, etiqueta: 'Otro estado', color: '#6B7280' },
  // El paciente no tiene consulta en la org activa: el LED va hueco.
  { id: 'sin_consulta', valor: null, etiqueta: 'Sin consulta', color: '#9CA3AF', hueco: true },
].map((e, orden) => ({ ...e, orden }));

const POR_VALOR = new Map(ESTADOS_FICHA.filter((e) => e.valor).map((e) => [e.valor, e]));
const OTRO = ESTADOS_FICHA.find((e) => e.id === 'otro');
const SIN_CONSULTA = ESTADOS_FICHA.find((e) => e.id === 'sin_consulta');

/** El estado de la ficha a partir del `estado` del episodio (o de su ausencia). */
export function estadoFicha(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return SIN_CONSULTA;
  return POR_VALOR.get(valor) || OTRO;
}

/** Sin mayúsculas ni tildes: "jose" encuentra a "José". */
export function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Fecha local del dispositivo (YYYY-MM-DD). toISOString() es UTC: en Ecuador, de noche ya es mañana. */
export function hoyLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Un paciente de alta desde ANTES de hoy ya no sale en la lista (PAPER §35): el día del
 * alta todavía se ve, para que quien la dio no lo pierda de golpe.
 */
export function altaVencida(asignacion, hoy = hoyLocal()) {
  return asignacion?.estado === 'alta' && !!asignacion.alta_at && asignacion.alta_at < hoy;
}
