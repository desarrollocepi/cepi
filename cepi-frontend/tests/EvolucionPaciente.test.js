import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({ getPatientEvolution: vi.fn(), obtenerEntidad: vi.fn() }));
import * as api from '../src/api.js';
import EvolucionPaciente from '../src/components/EvolucionPaciente.vue';

const FILAS = [
  {
    episode_id: 'ep2', fecha: '2026-10-01', medico: 'Dra. Primaria', especialista: 'Dra. Derma',
    diagnostico: 'Nevus atípico', diagnostico_histopatologico: 'Nevus displásico con atipia leve',
    tratamiento: 'Exéresis', observaciones: 'Cambió de color en 3 meses',
  },
  {
    episode_id: 'ep1', fecha: '2026-08-01', medico: 'Dra. Primaria', especialista: null,
    diagnostico: null, diagnostico_histopatologico: null, tratamiento: null, observaciones: null,
  },
];

// VisorEvolucion carga un iframe: aquí basta saber que se abrió.
const stubs = { VisorEvolucion: { name: 'VisorEvolucion', props: ['patientId', 'episodeId'], template: '<div class="visor-doble" />' } };

beforeEach(() => {
  api.getPatientEvolution.mockReset();
  api.getPatientEvolution.mockResolvedValue({ data: FILAS });
});

describe('EvolucionPaciente (PAPER §28)', () => {
  it('muestra las seis columnas, con el especialista debajo de quien atendió', async () => {
    const w = mount(EvolucionPaciente, { props: { patientId: 'p1', plegable: false }, global: { stubs } });
    await flushPromises();
    expect(w.findAll('th').map((t) => t.text())).toEqual(
      ['Fecha', 'Atendió', 'Diagnóstico clínico', 'Diagnóstico histopatológico', 'Tratamiento', 'Observaciones']);
    const [llena, vacia] = w.findAll('tbody tr');
    expect(llena.text()).toContain('Especialista: Dra. Derma');
    expect(llena.text()).toContain('Nevus displásico con atipia leve');
    expect(llena.text()).toContain('Cambió de color en 3 meses');
    expect(vacia.text()).toContain('Sin biopsia');
    expect(vacia.text()).toContain('Sin observaciones');
    expect(vacia.text()).not.toContain('Especialista:');
  });

  it('como pestaña carga sola, sin el botón de plegar, e Imprimir abre el documento', async () => {
    const w = mount(EvolucionPaciente, { props: { patientId: 'p1', plegable: false }, global: { stubs } });
    await flushPromises();
    expect(api.getPatientEvolution).toHaveBeenCalledWith('p1');
    const botones = w.findAll('.evo-barra button').map((b) => b.text());
    expect(botones).toEqual(['Actualizar', 'Imprimir']);
    await w.findAll('.evo-barra button')[1].trigger('click');
    expect(w.find('.visor-doble').exists()).toBe(true);
  });

  it('sin fichas, Imprimir queda deshabilitado con su motivo', async () => {
    api.getPatientEvolution.mockResolvedValue({ data: [] });
    const w = mount(EvolucionPaciente, { props: { patientId: 'p1', plegable: false }, global: { stubs } });
    await flushPromises();
    const imprimir = w.findAll('.evo-barra button')[1];
    expect(imprimir.attributes('disabled')).toBeDefined();
    expect(imprimir.attributes('title')).toContain('no hay nada que imprimir');
  });

  it('plegada dentro de la ficha no carga hasta que se abre', async () => {
    const w = mount(EvolucionPaciente, { props: { patientId: 'p1' }, global: { stubs } });
    await flushPromises();
    expect(api.getPatientEvolution).not.toHaveBeenCalled();
    await w.find('.evo-barra button').trigger('click'); await flushPromises();
    expect(api.getPatientEvolution).toHaveBeenCalledTimes(1);
    expect(w.findAll('tbody tr')).toHaveLength(2);
  });

  it('tocar otra fila pide abrir esa ficha', async () => {
    const w = mount(EvolucionPaciente, { props: { patientId: 'p1', episodeId: 'ep2', plegable: false }, global: { stubs } });
    await flushPromises();
    await w.findAll('tbody tr')[1].trigger('click');
    expect(w.emitted('navegar')).toEqual([['ep1']]);
  });
});
