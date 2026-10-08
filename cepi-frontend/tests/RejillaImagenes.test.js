import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({ galeria: vi.fn(), fetchAttachmentObjectUrl: vi.fn() }));
import { galeria, fetchAttachmentObjectUrl } from '../src/api.js';
import RejillaImagenes from '../src/components/RejillaImagenes.vue';

const img = (n, extra = {}) => ({
  id: 'i' + n, attachment_id: 'a' + n, paciente: 'Paciente ' + n, fecha: '2026-05-0' + n + 'T10:00:00Z',
  codigo_cie10: 'L40', diagnostico: 'Psoriasis', ...extra,
});

/** La búsqueda espera 350 ms a que el texto se quede quieto, también al montar. */
async function montar(props = {}) {
  const w = mount(RejillaImagenes, { props, global: { stubs: { teleport: true } } });
  await asentar();
  return w;
}
async function asentar() {
  await vi.advanceTimersByTimeAsync(350);
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  fetchAttachmentObjectUrl.mockImplementation(async (url) => 'blob:' + url.split('/')[3]);
  galeria.mockResolvedValue({ data: [img(1), img(2)], total: 2 });
});
afterEach(() => { vi.useRealTimers(); });

describe('RejillaImagenes', () => {
  it('"Cargando imágenes…" antes de la primera respuesta', async () => {
    const w = mount(RejillaImagenes);
    await flushPromises();
    expect(w.find('.rej-estado').text()).toBe('Cargando imágenes…');
  });

  it('pinta las celdas con paciente y pie (fecha · CIE-10 · diagnóstico)', async () => {
    const w = await montar();
    expect(galeria).toHaveBeenCalledWith({ q: '', patientId: '', offset: 0 });
    expect(w.findAll('.rej-celda')).toHaveLength(2);
    expect(w.find('.rej-nombre').text()).toBe('Paciente 1');
    expect(w.find('.rej-pie').text()).toBe('2026-05-01 · L40 · Psoriasis');
    expect(w.find('.rej-celda img').attributes('src')).toBe('blob:a1');
  });

  it('sin diagnóstico el pie usa la región del cuerpo', async () => {
    galeria.mockResolvedValue({ data: [img(1, { codigo_cie10: null, diagnostico: null, body_region: 'brazo' })], total: 1 });
    const w = await montar();
    expect(w.find('.rej-pie').text()).toBe('2026-05-01 · brazo');
  });

  it('con el paciente abierto no repite su nombre y pide solo sus imágenes', async () => {
    const w = await montar({ patientId: 'p9', mostrarPaciente: false });
    expect(galeria).toHaveBeenCalledWith({ q: '', patientId: 'p9', offset: 0 });
    expect(w.find('.rej-nombre').exists()).toBe(false);
  });

  it('vacío: el texto que le pasan; con búsqueda, que no hubo resultados', async () => {
    galeria.mockResolvedValue({ data: [], total: 0 });
    const w = await montar({ vacio: 'Este paciente todavía no tiene imágenes' });
    expect(w.find('.rej-estado').text()).toBe('Este paciente todavía no tiene imágenes');
    await w.setProps({ q: ' L40 ' });
    await asentar();
    expect(w.find('.rej-estado').text()).toBe('Sin resultados para «L40»');
  });

  it('la búsqueda espera a que el texto se quede quieto', async () => {
    const w = await montar();
    galeria.mockClear();
    await w.setProps({ q: 'p' });
    await vi.advanceTimersByTimeAsync(200);
    await w.setProps({ q: 'ps' });
    await vi.advanceTimersByTimeAsync(200);
    expect(galeria).not.toHaveBeenCalled();
    await asentar();
    expect(galeria).toHaveBeenCalledTimes(1);
    expect(galeria).toHaveBeenCalledWith({ q: 'ps', patientId: '', offset: 0 });
  });

  it('error con Reintentar', async () => {
    galeria.mockRejectedValueOnce(new Error('HTTP 500'));
    const w = await montar();
    expect(w.find('.rej-error').text()).toContain('No se pudieron cargar las imágenes: HTTP 500');
    await w.find('.rej-btn').trigger('click');
    await flushPromises();
    expect(w.findAll('.rej-celda')).toHaveLength(2);
  });

  it('"Ver más" solo si hay más, y agrega la página siguiente', async () => {
    galeria.mockResolvedValueOnce({ data: [img(1), img(2)], total: 3 });
    const w = await montar();
    galeria.mockResolvedValueOnce({ data: [img(3)], total: 3 });
    await w.find('.rej-mas').trigger('click');
    await flushPromises();
    expect(galeria).toHaveBeenLastCalledWith({ q: '', patientId: '', offset: 2 });
    expect(w.findAll('.rej-celda')).toHaveLength(3);
    expect(w.find('.rej-mas').exists()).toBe(false);
  });

  it('una respuesta vieja no pisa a la nueva', async () => {
    let soltarVieja;
    galeria.mockReturnValueOnce(new Promise((r) => { soltarVieja = r; }));
    const w = await montar();
    galeria.mockResolvedValueOnce({ data: [img(3)], total: 1 });
    await w.setProps({ q: 'nueva' });
    await asentar();
    soltarVieja({ data: [img(1), img(2)], total: 2 });
    await flushPromises();
    expect(w.findAll('.rej-celda')).toHaveLength(1);
  });

  it('una foto que no se puede bajar no rompe la rejilla ni abre el visor', async () => {
    fetchAttachmentObjectUrl.mockImplementation(async (url) => {
      if (url.includes('a1')) throw new Error('HTTP 404');
      return 'blob:a2';
    });
    const w = await montar();
    const celdas = w.findAll('.rej-celda');
    expect(celdas[0].find('.rej-ph').text()).toBe('Imagen no disponible');
    await celdas[0].trigger('click');
    expect(w.find('.lightbox').exists()).toBe(false);
    await celdas[1].trigger('click');
    expect(w.find('.lb-img').attributes('src')).toBe('blob:a2');
  });

  it('el visor lleva paciente y pie, y se cierra', async () => {
    const w = await montar();
    await w.find('.rej-celda').trigger('click');
    expect(w.find('.lb-pie').text()).toBe('Paciente 1 · 2026-05-01 · L40 · Psoriasis');
    await w.find('.lb-close').trigger('click');
    expect(w.find('.lightbox').exists()).toBe(false);
  });

  it('al desmontarse libera las miniaturas', async () => {
    const w = await montar();
    w.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a2');
  });
});
