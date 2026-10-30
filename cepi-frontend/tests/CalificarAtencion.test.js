// Calificación de la atención por QR (PAPER §29): cédula → estrellas → gracias. Pública:
// la abre el paciente en su teléfono, sin sesión.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({ lookupCareRating: vi.fn(), rateCare: vi.fn() }));
import * as api from '../src/api.js';
import CalificarAtencion from '../src/components/CalificarAtencion.vue';

const continuar = (w) => w.find('form button[type="submit"]');
async function escribirCedula(w, valor) {
  await w.find('input.c-cedula').setValue(valor);
  await w.find('form').trigger('submit');
  await flushPromises();
}

describe('CalificarAtencion', () => {
  beforeEach(() => {
    api.lookupCareRating.mockReset().mockResolvedValue({ ok: true, status: 'can_rate' });
    api.rateCare.mockReset().mockResolvedValue({ ok: true, status: 'rated' });
  });

  it('Continuar está deshabilitado hasta tener 6 dígitos; las letras se descartan', async () => {
    const w = mount(CalificarAtencion);
    expect(continuar(w).attributes('disabled')).toBeDefined();
    await w.find('input.c-cedula').setValue('09a12-3');
    expect(w.find('input.c-cedula').element.value).toBe('09123');
    expect(continuar(w).attributes('disabled')).toBeDefined();
    await w.find('input.c-cedula').setValue('0912345678');
    expect(continuar(w).attributes('disabled')).toBeUndefined();
  });

  it('cédula con atención → estrellas → envía la nota y agradece', async () => {
    const w = mount(CalificarAtencion);
    await escribirCedula(w, '0912345678');
    expect(api.lookupCareRating).toHaveBeenCalledWith('0912345678');

    const stars = w.findAll('.c-star');
    expect(stars).toHaveLength(5);
    const enviar = w.findAll('.c-actions button').find((b) => b.text() === 'Enviar');
    expect(enviar.attributes('disabled')).toBeDefined();
    await stars[3].trigger('click');
    expect(w.find('.c-label').text()).toBe('Buena');
    expect(w.findAll('.c-star.on')).toHaveLength(4);

    await enviar.trigger('click');
    await flushPromises();
    expect(api.rateCare).toHaveBeenCalledWith('0912345678', 4);
    expect(w.find('.c-result h1').text()).toBe('¡Gracias por tu calificación!');
    // Ya calificada: no hay "otra vez", pero el botón se ve, deshabilitado.
    expect(w.find('.c-result button').attributes('disabled')).toBeDefined();
  });

  it('sin atención reciente o ya calificada: lo dice y deja corregir la cédula', async () => {
    api.lookupCareRating.mockResolvedValueOnce({ ok: true, status: 'no_episode' });
    const w = mount(CalificarAtencion);
    await escribirCedula(w, '0912345678');
    expect(w.find('.c-result h1').text()).toBe('No encontramos tu atención');
    expect(w.find('.c-star').exists()).toBe(false);

    await w.find('.c-result button').trigger('click');
    expect(w.find('input.c-cedula').element.value).toBe('');

    api.lookupCareRating.mockResolvedValueOnce({ ok: true, status: 'already_rated' });
    await escribirCedula(w, '0912345678');
    expect(w.find('.c-result h1').text()).toBe('Ya calificaste tu atención');
  });

  it('una atención pasada dice caducado, sin explicar plazos', async () => {
    api.lookupCareRating.mockResolvedValueOnce({ ok: true, status: 'expired' });
    const w = mount(CalificarAtencion);
    await escribirCedula(w, '0912345678');
    expect(w.find('.c-result h1').text()).toBe('Caducado');
    expect(w.text()).not.toMatch(/24|hora/);
  });

  it('si al enviar ya estaba calificada (otro envío ganó), muestra eso', async () => {
    api.rateCare.mockResolvedValueOnce({ ok: true, status: 'already_rated' });
    const w = mount(CalificarAtencion);
    await escribirCedula(w, '0912345678');
    await w.findAll('.c-star')[4].trigger('click');
    await w.findAll('.c-actions button').find((b) => b.text() === 'Enviar').trigger('click');
    await flushPromises();
    expect(w.find('.c-result h1').text()).toBe('Ya calificaste tu atención');
  });

  it('un 429 pide esperar; sin red, reintentar; sigue en el mismo paso', async () => {
    api.lookupCareRating.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 }));
    const w = mount(CalificarAtencion);
    await escribirCedula(w, '0912345678');
    expect(w.find('.c-error').text()).toContain('Demasiados intentos');
    expect(w.find('input.c-cedula').exists()).toBe(true);

    api.lookupCareRating.mockRejectedValueOnce(new Error('Failed to fetch'));
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('.c-error').text()).toContain('No hay conexión');
  });
});
