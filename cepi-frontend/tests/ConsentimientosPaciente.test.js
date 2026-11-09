import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({
  listarConsentimientos: vi.fn(),
  guardarConsentimientos: vi.fn(),
  uploadAttachment: vi.fn(),
  fetchAttachmentObjectUrl: vi.fn(),
}));
import * as api from '../src/api.js';
import ConsentimientosPaciente from '../src/components/ConsentimientosPaciente.vue';

const montar = () => mount(ConsentimientosPaciente, {
  props: { patientId: 'p1' },
  global: { stubs: { VisorImagen: true } },
});
const caja = (w, tipo) => w.find(`[data-tipo="${tipo}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchAttachmentObjectUrl.mockImplementation(async (u) => `blob:${u}`);
});

describe('ConsentimientosPaciente (PAPER §31)', () => {
  it('muestra los dos recuadros separados, con quién firma cada uno', async () => {
    api.listarConsentimientos.mockResolvedValue({
      ok: true,
      informado: [{ id: 'c1', attachment_id: 'a1', fecha: '2026-11-09' }],
      privacidad_datos: [],
    });
    const w = montar();
    await flushPromises();
    expect(api.listarConsentimientos).toHaveBeenCalledWith('p1');
    expect(caja(w, 'informado').text()).toContain('Consentimiento informado');
    expect(caja(w, 'informado').text()).toContain('Lo firma el paciente');
    expect(caja(w, 'informado').find('img').attributes('src')).toBe('blob:/api/attachments/a1/file');
    expect(caja(w, 'privacidad_datos').text()).toContain('Lo firma el profesional que atiende');
    expect(caja(w, 'privacidad_datos').text()).toContain('Todavía no hay foto');
    // El botón de subir está en los dos, habilitado.
    expect(caja(w, 'privacidad_datos').find('input[type=file]').attributes('disabled')).toBeUndefined();
  });

  it('un registro viejo sin foto se ve deshabilitado con el motivo', async () => {
    api.listarConsentimientos.mockResolvedValue({ informado: [{ id: 'c0', attachment_id: null, fecha: '2026-10-01' }], privacidad_datos: [] });
    const w = montar();
    await flushPromises();
    const b = caja(w, 'informado').find('.cons-foto');
    expect(b.attributes('disabled')).toBeDefined();
    expect(b.attributes('title')).toContain('sin foto');
  });

  it('subir una foto la guarda como privacidad_datos y recarga', async () => {
    api.listarConsentimientos.mockResolvedValue({ informado: [], privacidad_datos: [] });
    api.uploadAttachment.mockResolvedValue({ id: 'att-9' });
    api.guardarConsentimientos.mockResolvedValue({ ok: true, ids: ['c9'] });
    const w = montar();
    await flushPromises();
    const input = caja(w, 'privacidad_datos').find('input[type=file]');
    const file = new File(['x'], 'firma.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input.element, 'files', { value: [file] });
    await input.trigger('change');
    await flushPromises();
    expect(api.uploadAttachment).toHaveBeenCalledWith(file);
    expect(api.guardarConsentimientos).toHaveBeenCalledWith({ patientId: 'p1', tipo: 'privacidad_datos', attachmentIds: ['att-9'] });
    expect(api.listarConsentimientos).toHaveBeenCalledTimes(2);
    expect(caja(w, 'privacidad_datos').text()).toContain('Foto guardada');
  });

  it('si falla la carga lo dice y deja reintentar', async () => {
    api.listarConsentimientos.mockRejectedValue(new Error('HTTP 500'));
    const w = montar();
    await flushPromises();
    expect(w.text()).toContain('No se pudieron cargar los consentimientos: HTTP 500');
    expect(caja(w, 'informado').find('input[type=file]').attributes('disabled')).toBeDefined();
  });
});
