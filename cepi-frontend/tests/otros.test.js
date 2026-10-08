// Galería de la organización y consulta de DoctoPro.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h, defineComponent } from 'vue';

vi.mock('../src/api.js', () => ({ searchDoctoProPatients: vi.fn(), getDoctoProPatient: vi.fn(), galeria: vi.fn(), fetchAttachmentObjectUrl: vi.fn() }));
import * as api from '../src/api.js';
import Galeria from '../src/components/Galeria.vue';
import DoctoProSearch from '../src/components/DoctoProSearch.vue';

describe('Galeria', () => {
  it('la rejilla recibe lo que se escribe en el buscador, sin paciente (toda la org)', async () => {
    const Rejilla = defineComponent({ name: 'RejillaImagenes', props: ['q', 'vacio', 'patientId'], render: () => h('div') });
    const w = mount(Galeria, { global: { stubs: { RejillaImagenes: Rejilla } } });
    expect(w.findComponent(Rejilla).props()).toMatchObject({ q: '', vacio: 'Todavía no hay imágenes en esta organización' });
    expect(w.findComponent(Rejilla).props('patientId')).toBeUndefined();
    await w.find('.gal-buscar').setValue('L40');
    expect(w.findComponent(Rejilla).props('q')).toBe('L40');
  });
});

describe('DoctoProSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.searchDoctoProPatients.mockResolvedValue({ pacientes: [
      { id: 7, value: 'Ana Pérez', nombre: 'Ana', apellido: 'Pérez', cedula: '0101', telefono: '099' },
      { id: 8, value: 'Ana López', nombre: 'Ana', apellido: 'López' },
    ] });
  });
  afterEach(() => vi.useRealTimers());
  async function buscar(w, texto) {
    await w.find('.dp-search').setValue(texto);
    await vi.advanceTimersByTimeAsync(280);
    await flushPromises();
  }

  it('pide al menos 2 letras y espera a que se deje de escribir', async () => {
    const w = mount(DoctoProSearch);
    expect(w.find('.dp-muted').text()).toBe('Escribe al menos 2 letras.');
    await buscar(w, 'a');
    expect(api.searchDoctoProPatients).not.toHaveBeenCalled();
    await w.find('.dp-search').setValue('an');
    expect(w.find('.dp-muted').text()).toBe('Buscando…');
    await w.find('.dp-search').setValue('ana');
    await vi.advanceTimersByTimeAsync(280); await flushPromises();
    expect(api.searchDoctoProPatients).toHaveBeenCalledTimes(1);
    expect(api.searchDoctoProPatients).toHaveBeenCalledWith('ana');
  });

  it('lista los resultados con cédula y teléfono', async () => {
    const w = mount(DoctoProSearch);
    await buscar(w, 'ana');
    expect(w.findAll('.dp-name').map((n) => n.text())).toEqual(['👤 Ana Pérez', '👤 Ana López']);
    expect(w.findAll('.dp-meta').map((n) => n.text())).toEqual(['0101 · 099', 's/cédula']);
  });

  it('abrir un paciente muestra lo básico ya y completa con el detalle', async () => {
    let soltar;
    api.getDoctoProPatient.mockReturnValue(new Promise((r) => { soltar = r; }));
    const w = mount(DoctoProSearch);
    await buscar(w, 'ana');
    await w.find('.dp-item').trigger('click');
    expect(w.find('.dp-detail h3').text()).toBe('Ana Pérez');
    expect(w.findAll('.dp-fields dd')[3].text()).toBe('—');
    soltar({ usuario: { email: 'ana@x.ec', ocupacion: 'Docente' } });
    await flushPromises();
    expect(w.findAll('.dp-fields dd')[3].text()).toBe('ana@x.ec');
    expect(w.find('.dp-src').text()).toContain('id 7');
    await w.find('.dp-back').trigger('click');
    expect(w.findAll('.dp-item')).toHaveLength(2);
  });

  it('si el detalle falla se queda con lo básico', async () => {
    api.getDoctoProPatient.mockRejectedValue(new Error('HTTP 500'));
    const w = mount(DoctoProSearch);
    await buscar(w, 'ana');
    await w.find('.dp-item').trigger('click');
    await flushPromises();
    expect(w.find('.dp-detail h3').text()).toBe('Ana Pérez');
    expect(w.find('.dp-error').exists()).toBe(false);
  });

  it('sin resultados y errores: distingue "no configurada" (503) de un fallo cualquiera', async () => {
    api.searchDoctoProPatients.mockResolvedValue({ pacientes: [] });
    const w = mount(DoctoProSearch);
    await buscar(w, 'zz');
    expect(w.find('.dp-muted').text()).toBe('Sin resultados para “zz”.');
    api.searchDoctoProPatients.mockRejectedValue(Object.assign(new Error('DoctoPro no disponible'), { status: 503 }));
    await buscar(w, 'zzz');
    expect(w.find('.dp-error').text()).toBe('Integración DoctoPro no configurada.');
    api.searchDoctoProPatients.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await buscar(w, 'zzzz');
    expect(w.find('.dp-error').text()).toBe('No se pudo consultar DoctoPro.');
  });

  it('cerrar con el botón o tocando fuera', async () => {
    const w = mount(DoctoProSearch);
    await w.find('.dp-head button').trigger('click');
    await w.find('.dp-modal').trigger('click');
    expect(w.emitted('close')).toHaveLength(2);
  });
});
