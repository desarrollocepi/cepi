import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({
  listarEvolucion: vi.fn(), obtenerEntidad: vi.fn(), guardarGrupoFicha: vi.fn(),
  agregarEvolucion: vi.fn(), editarEvolucion: vi.fn(),
}));
import * as api from '../src/api.js';
import EvolucionPaciente from '../src/components/EvolucionPaciente.vue';

// Como las da GET /api/patient-evolution (PAPER §28.4): la ficha ep2 con dos evoluciones
// registradas (la inicial abajo) y la ficha ep1, vieja, sin evoluciones (fila armada).
const FILAS = [
  {
    episode_id: 'ep2', evolution_id: 'ev2', motivo: 'Lunar que cambió', estado: 'respondida', es_inicial: false,
    fecha: '2026-10-20', medico: 'Dra. Derma', especialista: null, diagnostico: 'D22.5 — Nevus',
    diagnostico_histopatologico: 'Nevus displásico con atipia leve', tratamiento: 'Control dermatoscópico',
    observaciones: 'Sin cambios', hallazgos: 'Lesión estable', proximo_control_fecha: '2027-01-20', proximo_control_motivo: 'Dermatoscopia',
  },
  {
    episode_id: 'ep2', evolution_id: 'ev1', motivo: 'Lunar que cambió', estado: 'respondida', es_inicial: true,
    fecha: '2026-10-01', medico: 'Dra. Primaria', especialista: 'Dra. Derma', diagnostico: 'Nevus atípico',
    diagnostico_histopatologico: null, tratamiento: 'Exéresis', observaciones: 'Cambió de color en 3 meses',
    hallazgos: null, proximo_control_fecha: null, proximo_control_motivo: null,
  },
  {
    episode_id: 'ep1', evolution_id: null, motivo: 'Acné', estado: 'cerrado', es_inicial: true,
    fecha: '2026-08-01', medico: 'Dra. Primaria', especialista: null, diagnostico: null,
    diagnostico_histopatologico: null, tratamiento: null, observaciones: null, hallazgos: null,
    proximo_control_fecha: null, proximo_control_motivo: null,
  },
];

// VisorEvolucion carga un iframe: aquí basta saber que se abrió.
const stubs = { VisorEvolucion: { name: 'VisorEvolucion', props: ['patientId', 'episodeId'], template: '<div class="visor-doble" />' } };

const montar = async (props = {}) => {
  const w = mount(EvolucionPaciente, { props: { patientId: 'p1', plegable: false, ...props }, global: { stubs } });
  await flushPromises();
  return w;
};
const agregar = (w) => w.findAll('button').find((b) => b.text() === '＋ Agregar evolución');

beforeEach(() => {
  api.listarEvolucion.mockReset();
  api.listarEvolucion.mockResolvedValue({ data: FILAS });
});

describe('EvolucionPaciente (PAPER §28, §28.4)', () => {
  it('muestra las evoluciones de la ficha más nueva, con su cabecera y las seis columnas', async () => {
    const w = await montar();
    expect(w.find('.evo-ficha-motivo').text()).toBe('Lunar que cambió');
    expect(w.find('.evo-ficha-meta').text()).toContain('Abierta el 2026-10-01');
    expect(w.find('.evo-ficha-meta').text()).toContain('Respondida');
    expect(w.find('.evo-ficha-meta').text()).toContain('2 evoluciones');
    expect(w.findAll('th').map((t) => t.text())).toEqual(
      ['Fecha', 'Atendió', 'Diagnóstico clínico', 'Diagnóstico histopatológico', 'Tratamiento', 'Observaciones']);
    const [nueva, inicial] = w.findAll('tbody tr');
    expect(w.findAll('tbody tr')).toHaveLength(2);
    expect(nueva.text()).toContain('Hallazgos: Lesión estable');
    expect(nueva.text()).toContain('Próximo control: 2027-01-20 · Dermatoscopia');
    expect(nueva.text()).toContain('Nevus displásico con atipia leve');
    expect(inicial.text()).toContain('Primera cita');
    expect(inicial.text()).toContain('Especialista: Dra. Derma');
    expect(w.find('.evo-cuenta').text()).toBe('2 evoluciones en esta ficha · 2 fichas');
  });

  it('con episodeId muestra esa ficha; la fila armada no dice «Primera cita»', async () => {
    const w = await montar({ episodeId: 'ep1' });
    expect(w.find('.evo-ficha-motivo').text()).toBe('Acné');
    const filas = w.findAll('tbody tr');
    expect(filas).toHaveLength(1);
    expect(filas[0].text()).toContain('Sin biopsia');
    expect(filas[0].text()).toContain('Sin observaciones');
    expect(filas[0].text()).not.toContain('Primera cita');
  });

  it('otras fichas plegadas: una línea por ficha y tocarla la abre', async () => {
    const w = await montar();
    const btn = w.find('.evo-otras-btn');
    expect(btn.text()).toContain('Otras fichas del paciente (1)');
    expect(w.find('.evo-otra').exists()).toBe(false);
    await btn.trigger('click');
    const otra = w.find('.evo-otra');
    expect(otra.text()).toContain('Acné');
    expect(otra.text()).toContain('Cerrada');
    expect(otra.text()).toContain('1 evolución');
    await otra.trigger('click');
    expect(w.emitted('navegar')).toEqual([['ep1']]);
  });

  it('con una sola ficha, «Otras fichas» sale deshabilitado con el motivo', async () => {
    api.listarEvolucion.mockResolvedValue({ data: FILAS.slice(0, 2) });
    const w = await montar();
    const btn = w.find('.evo-otras-btn');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.attributes('title')).toBe('Es la única ficha de este paciente');
  });

  it('como pestaña carga sola, sin el botón de plegar, e Imprimir abre el documento', async () => {
    const w = await montar();
    expect(api.listarEvolucion).toHaveBeenCalledWith('p1');
    expect(w.findAll('.evo-barra button').map((b) => b.text())).toEqual(['Actualizar', 'Imprimir']);
    await w.findAll('.evo-barra button')[1].trigger('click');
    expect(w.find('.visor-doble').exists()).toBe(true);
  });

  it('sin fichas: lo dice, e Imprimir y Agregar quedan deshabilitados con su motivo', async () => {
    api.listarEvolucion.mockResolvedValue({ data: [] });
    const w = await montar();
    expect(w.find('.evo-ficha-meta').text()).toContain('todavía no tiene fichas');
    const imprimir = w.findAll('.evo-barra button')[1];
    expect(imprimir.attributes('disabled')).toBeDefined();
    expect(imprimir.attributes('title')).toContain('no hay nada que imprimir');
    expect(agregar(w).attributes('disabled')).toBeDefined();
    expect(agregar(w).attributes('title')).toContain('Nueva consulta');
  });

  it('plegada dentro de la ficha no carga hasta que se abre', async () => {
    const w = mount(EvolucionPaciente, { props: { patientId: 'p1', episodeId: 'ep2' }, global: { stubs } });
    await flushPromises();
    expect(api.listarEvolucion).not.toHaveBeenCalled();
    await w.find('.evo-barra button').trigger('click'); await flushPromises();
    expect(api.listarEvolucion).toHaveBeenCalledTimes(1);
    expect(w.findAll('tbody tr')).toHaveLength(2);
  });
});

describe('EvolucionPaciente — agregar evolución', () => {
  beforeEach(() => {
    api.agregarEvolucion.mockReset();
    api.agregarEvolucion.mockResolvedValue({ ok: true, evolution_id: 'ev3' });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('la fecha por defecto es hoy en la zona local, no el día UTC', async () => {
    // 23:30 del 9 de noviembre en Ecuador ya es 10 de noviembre en UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 23, 30));
    const w = await montar();
    await agregar(w).trigger('click');
    expect(w.find('.evo-form input[type="date"]').element.value).toBe('2026-11-09');
  });

  it('pide al menos un dato; guarda en la ficha abierta, recarga y avisa', async () => {
    const w = await montar();
    await agregar(w).trigger('click');
    expect(agregar(w).attributes('disabled')).toBeDefined();
    expect(agregar(w).attributes('title')).toBe('Ya estás agregando una evolución');
    const guardar = () => w.find('.evo-form button[type="submit"]');
    expect(guardar().attributes('disabled')).toBeDefined();
    expect(guardar().attributes('title')).toContain('al menos');
    const areas = w.findAll('.evo-form textarea');
    await areas[0].setValue('  Lesión más pequeña ');
    await areas[1].setValue('Seguir igual');
    await w.find('.evo-form input[type="date"]').setValue('2026-11-05');
    await w.findAll('.evo-form input[type="date"]')[1].setValue('2027-02-05');
    await w.find('.evo-form input[type="text"][placeholder="Motivo del próximo control"]').setValue('Dermatoscopia');
    expect(guardar().attributes('disabled')).toBeUndefined();
    await w.find('.evo-form').trigger('submit'); await flushPromises();
    expect(api.agregarEvolucion).toHaveBeenCalledWith({
      episodeId: 'ep2', fecha: '2026-11-05', hallazgos: 'Lesión más pequeña', diagnostico: '',
      tratamiento: 'Seguir igual', observaciones: '', proximoControlFecha: '2027-02-05', proximoControlMotivo: 'Dermatoscopia',
    });
    expect(w.find('.evo-form').exists()).toBe(false);
    expect(api.listarEvolucion).toHaveBeenCalledTimes(2);
    expect(w.emitted('guardado')).toEqual([['ep2']]);
  });

  it('el diagnóstico usa el buscador CIE-10 de la ficha', async () => {
    const w = await montar();
    await agregar(w).trigger('click');
    expect(w.findComponent({ name: 'IcdSearchField' }).exists()).toBe(true);
  });

  it('si falla, lo dice y deja el formulario', async () => {
    api.agregarEvolucion.mockRejectedValue(new Error('Esta ficha está de alta: abre una consulta nueva'));
    const w = await montar();
    await agregar(w).trigger('click');
    await w.findAll('.evo-form textarea')[0].setValue('Algo');
    await w.find('.evo-form').trigger('submit'); await flushPromises();
    expect(w.find('.evo-form .evo-obs-error').text()).toBe('Esta ficha está de alta: abre una consulta nueva');
    expect(w.findAll('.evo-form textarea')[0].element.value).toBe('Algo');
  });

  it('ficha de alta: deshabilitado con el motivo, no escondido', async () => {
    api.listarEvolucion.mockResolvedValue({ data: FILAS.map((f) => ({ ...f, estado: 'alta' })) });
    const w = await montar();
    expect(agregar(w).attributes('disabled')).toBeDefined();
    expect(agregar(w).attributes('title')).toBe('Esta ficha está de alta: abre una consulta nueva');
  });
});

describe('EvolucionPaciente — observaciones editables', () => {
  beforeEach(() => {
    api.guardarGrupoFicha.mockReset();
    api.guardarGrupoFicha.mockResolvedValue({ ok: true });
    api.editarEvolucion.mockReset();
    api.editarEvolucion.mockResolvedValue({ ok: true });
  });

  it('en una evolución registrada guarda con editarEvolucion', async () => {
    const w = await montar();
    await w.findAll('.evo-obs-editar')[1].trigger('click');
    const guardar = () => w.findAll('.evo-obs-acciones button')[0];
    expect(guardar().attributes('disabled')).toBeDefined(); // sin cambios todavía
    await w.find('.evo-obs-texto').setValue('  Control con dermatología en 6 meses ');
    await guardar().trigger('click'); await flushPromises();
    expect(api.editarEvolucion).toHaveBeenCalledWith({ evolutionId: 'ev1', observaciones: 'Control con dermatología en 6 meses' });
    expect(api.guardarGrupoFicha).not.toHaveBeenCalled();
    expect(w.find('.evo-obs-texto').exists()).toBe(false);
    expect(w.findAll('tbody tr')[1].text()).toContain('Control con dermatología en 6 meses');
    expect(w.emitted('guardado')).toEqual([['ep2']]);
  });

  it('en la fila armada guarda solo observaciones en la sección 7 de esa ficha', async () => {
    const w = await montar({ episodeId: 'ep1' });
    await w.find('.evo-obs-editar').trigger('click');
    await w.find('.evo-obs-texto').setValue('Resumen');
    await w.findAll('.evo-obs-acciones button')[0].trigger('click'); await flushPromises();
    expect(api.guardarGrupoFicha).toHaveBeenCalledWith({
      groupId: 'g_7', data: { observaciones: 'Resumen' }, episodeId: 'ep1', patientId: 'p1',
    });
    expect(api.editarEvolucion).not.toHaveBeenCalled();
  });

  it('mientras se edita una, las demás se deshabilitan con el motivo', async () => {
    const w = await montar();
    await w.findAll('.evo-obs-editar')[0].trigger('click');
    const otro = w.findAll('.evo-obs-editar')[0]; // la única que queda, la de la otra fila
    expect(otro.attributes('disabled')).toBeDefined();
    expect(otro.attributes('title')).toContain('Termina primero');
  });

  it('si falla, lo dice y deja el texto para reintentar', async () => {
    api.editarEvolucion.mockRejectedValue(new Error('Sin permiso para editar esta ficha'));
    const w = await montar();
    await w.findAll('.evo-obs-editar')[0].trigger('click');
    await w.find('.evo-obs-texto').setValue('Otro resumen');
    await w.findAll('.evo-obs-acciones button')[0].trigger('click'); await flushPromises();
    expect(w.find('.evo-obs-error').text()).toBe('Sin permiso para editar esta ficha');
    expect(w.find('.evo-obs-texto').element.value).toBe('Otro resumen');
  });

  it('Cancelar vuelve sin guardar', async () => {
    const w = await montar();
    await w.findAll('.evo-obs-editar')[0].trigger('click');
    await w.find('.evo-obs-texto').setValue('No lo quiero');
    await w.findAll('.evo-obs-acciones button')[1].trigger('click');
    expect(api.editarEvolucion).not.toHaveBeenCalled();
    expect(w.findAll('tbody tr')[0].text()).toContain('Sin cambios');
  });
});
