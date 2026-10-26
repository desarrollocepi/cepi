// Ficha de evolución en modal (PAPER §28): el documento evolucion.html se llena con la
// evolución y los datos del paciente, y tocar una fila pide abrir esa ficha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({ getPatientEvolution: vi.fn(), obtenerEntidad: vi.fn() }));
import * as api from '../src/api.js';
import VisorEvolucion from '../src/components/VisorEvolucion.vue';

const FILAS = [
  { episode_id: 'ep2', fecha: '2026-10-01', medico: 'Dra. Ana Pérez', diagnostico: 'L40.0 — Psoriasis', tratamiento: 'Clobetasol' },
  { episode_id: 'ep1', fecha: '2026-08-15', medico: 'Dr. Juan Espejo', diagnostico: null, tratamiento: null },
];

// El iframe de happy-dom no carga evolucion.html: se pone una ventana falsa y se
// dispara el load a mano.
function documentoFalso(w) {
  const win = { fillEvolucion: vi.fn(), errorEvolucion: vi.fn(), print: vi.fn() };
  Object.defineProperty(w.find('iframe').element, 'contentWindow', { value: win });
  return win;
}

describe('VisorEvolucion — ficha de evolución en modal', () => {
  beforeEach(() => {
    api.getPatientEvolution.mockReset().mockResolvedValue({ ok: true, data: FILAS });
    api.obtenerEntidad.mockReset().mockResolvedValue({ data: { nombre: 'Test2', apellidos: 'Apellido', cedula: '1234567897', fecha_nac: '1990-01-01' } });
  });

  it('carga evolucion.html y lo llena con el paciente y sus fichas', async () => {
    const w = mount(VisorEvolucion, { props: { patientId: 'p1', episodeId: 'ep2' } });
    expect(w.find('iframe').attributes('src')).toBe('/evolucion.html');
    const win = documentoFalso(w);
    await w.find('iframe').trigger('load');
    await flushPromises();
    expect(api.getPatientEvolution).toHaveBeenCalledWith('p1');
    const datos = win.fillEvolucion.mock.calls.at(-1)[0];
    expect(datos.paciente).toMatchObject({ nombre: 'Test2 Apellido', cedula: '1234567897' });
    expect(datos.paciente.edad).toBeGreaterThan(30);
    expect(datos.filas).toEqual(FILAS);
    expect(datos.actual).toBe('ep2');
  });

  it('tocar otra fila pide abrir esa ficha; la actual no', async () => {
    const w = mount(VisorEvolucion, { props: { patientId: 'p1', episodeId: 'ep2' } });
    const win = documentoFalso(w);
    await w.find('iframe').trigger('load');
    await flushPromises();
    win.onAbrirFicha('ep2');
    expect(w.emitted('abrir')).toBeUndefined();
    win.onAbrirFicha('ep1');
    expect(w.emitted('abrir')[0]).toEqual(['ep1']);
  });

  it('si falla lo dice en el documento e Imprimir queda deshabilitado con su motivo', async () => {
    api.getPatientEvolution.mockRejectedValueOnce(new Error('sin red'));
    const w = mount(VisorEvolucion, { props: { patientId: 'p1' } });
    const win = documentoFalso(w);
    await w.find('iframe').trigger('load');
    await flushPromises();
    expect(win.errorEvolucion).toHaveBeenCalledWith('sin red');
    const imprimir = w.findAll('button').find((b) => b.text() === 'Imprimir');
    expect(imprimir.element.disabled).toBe(true);
    expect(imprimir.attributes('title')).toContain('No se pudo');
  });

  it('Cerrar emite close', async () => {
    const w = mount(VisorEvolucion, { props: { patientId: 'p1' } });
    await w.findAll('button').find((b) => b.text() === 'Cerrar').trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });
});
