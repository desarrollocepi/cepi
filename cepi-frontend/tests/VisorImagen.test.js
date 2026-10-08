import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import VisorImagen from '../src/components/VisorImagen.vue';

// El visor va por Teleport al body; con el stub se queda dentro del wrapper.
const montar = (props) => mount(VisorImagen, { props, global: { stubs: { teleport: true } } });
// Sin espacios: el DOM simulado y el navegador no serializan igual el `transform`.
const transform = (w) => w.find('.lb-img').attributes('style').replace(/\s+/g, '');

describe('VisorImagen', () => {
  it('sin src no pinta nada', () => {
    expect(montar({ src: '' }).find('.lightbox').exists()).toBe(false);
  });

  it('con src muestra la imagen sin zoom y el pie', () => {
    const w = montar({ src: 'blob:a', pie: 'Ana · 2026-05-06' });
    expect(w.find('.lb-img').attributes('src')).toBe('blob:a');
    expect(w.find('.lb-img').attributes('alt')).toBe('Ana · 2026-05-06');
    expect(w.find('.lb-pie').text()).toBe('Ana · 2026-05-06');
    expect(transform(w)).toContain('scale(1)');
  });

  it('sin pie no deja el hueco y el alt es genérico', () => {
    const w = montar({ src: 'blob:a' });
    expect(w.find('.lb-pie').exists()).toBe(false);
    expect(w.find('.lb-img').attributes('alt')).toBe('Imagen clínica');
  });

  it('doble clic acerca a 2.5 y otro doble clic vuelve a 1', async () => {
    const w = montar({ src: 'blob:a' });
    await w.find('.lb-img').trigger('dblclick');
    expect(transform(w)).toContain('scale(2.5)');
    await w.find('.lb-img').trigger('dblclick');
    expect(transform(w)).toContain('scale(1)');
  });

  it('la rueda acerca y aleja, entre 1 y 6', async () => {
    const w = montar({ src: 'blob:a' });
    await w.find('.lightbox').trigger('wheel', { deltaY: 100 });
    expect(transform(w)).toContain('scale(1)');           // no baja de 1
    for (let i = 0; i < 40; i++) await w.find('.lightbox').trigger('wheel', { deltaY: -100 });
    expect(transform(w)).toContain('scale(6)');           // ni pasa de 6
  });

  it('arrastrar mueve solo con zoom, y volver a 1 recentra', async () => {
    const w = montar({ src: 'blob:a' });
    const img = w.find('.lb-img');
    await img.trigger('pointerdown', { clientX: 10, clientY: 10 });
    await img.trigger('pointermove', { clientX: 60, clientY: 40 });
    await img.trigger('pointerup');
    expect(transform(w)).toContain('translate(0px,0px)');
    await img.trigger('dblclick');
    await img.trigger('pointerdown', { clientX: 10, clientY: 10 });
    await img.trigger('pointermove', { clientX: 60, clientY: 40 });
    await img.trigger('pointerup');
    expect(transform(w)).toContain('translate(50px,30px)');
    await img.trigger('pointermove', { clientX: 200, clientY: 200 });   // ya soltó: no sigue
    expect(transform(w)).toContain('translate(50px,30px)');
    await img.trigger('dblclick');
    expect(transform(w)).toContain('translate(0px,0px)');
  });

  it('pellizcar con dos dedos escala según la distancia', async () => {
    const w = montar({ src: 'blob:a' });
    const img = w.find('.lb-img');
    const dedos = (d) => ({ touches: [{ clientX: 0, clientY: 0 }, { clientX: d, clientY: 0 }] });
    await img.trigger('touchstart', dedos(100));
    await img.trigger('touchmove', dedos(300));
    expect(transform(w)).toContain('scale(3)');
    await img.trigger('touchend', { touches: [] });
    await img.trigger('touchmove', dedos(600));   // sin pellizco en curso no cambia
    expect(transform(w)).toContain('scale(3)');
  });

  it('cierra con ✕, con clic en el fondo y con Escape; el clic en la imagen no cierra', async () => {
    const w = montar({ src: 'blob:a' });
    await w.find('.lb-img').trigger('click');
    expect(w.emitted('cerrar')).toBeUndefined();
    await w.find('.lb-close').trigger('click');
    await w.find('.lightbox').trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('cerrar')).toHaveLength(3);
  });

  it('cerrado o desmontado no escucha Escape', async () => {
    const w = montar({ src: 'blob:a' });
    await w.setProps({ src: '' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('cerrar')).toBeUndefined();
    await w.setProps({ src: 'blob:b' });
    w.unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('cerrar')).toBeUndefined();
  });

  it('otra imagen arranca sin el zoom de la anterior', async () => {
    const w = montar({ src: 'blob:a' });
    await w.find('.lb-img').trigger('dblclick');
    await w.setProps({ src: 'blob:b' });
    expect(transform(w)).toContain('scale(1)');
  });
});
