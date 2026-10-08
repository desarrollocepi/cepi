// Piezas que hablan con el navegador: el botón atrás (useBackStack) y el dictado web.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';

describe('useBackStack', () => {
  let pushView, removeView, bindBackState, empujadas;
  beforeEach(async () => {
    vi.resetModules();
    ({ pushView, removeView, bindBackState } = await import('../src/useBackStack.js'));
    empujadas = vi.spyOn(history, 'pushState').mockImplementation(() => {});
  });
  const atras = () => window.dispatchEvent(new PopStateEvent('popstate'));

  it('abrir una vista deja un centinela en el historial; atrás la cierra', () => {
    const cerrar = vi.fn();
    pushView(cerrar);
    expect(empujadas).toHaveBeenCalledTimes(1);
    atras();
    expect(cerrar).toHaveBeenCalledTimes(1);
    atras();                                   // en la raíz, atrás ya no es nuestro
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it('anidadas: atrás cierra la de arriba y se rearma para la siguiente', () => {
    const a = vi.fn(); const b = vi.fn();
    pushView(a); pushView(b);
    expect(empujadas).toHaveBeenCalledTimes(1);   // un solo centinela para la pila
    atras();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(empujadas).toHaveBeenCalledTimes(2);   // rearmado: queda una abierta
    atras();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('una vista cerrada por su propio botón sale de la pila', () => {
    const cerrar = vi.fn();
    removeView(pushView(cerrar));
    atras();
    expect(cerrar).not.toHaveBeenCalled();
  });

  it('un cierre que falla no rompe el atrás de las demás', () => {
    const a = vi.fn();
    pushView(a); pushView(() => { throw new Error('boom'); });
    expect(() => atras()).not.toThrow();
    atras();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('bindBackState ata un estado de Vue: abrir apila, cerrar desapila', async () => {
    const abierta = ref(false);
    bindBackState(() => abierta.value, () => { abierta.value = false; });
    abierta.value = true; await nextTick();
    atras(); await nextTick();
    expect(abierta.value).toBe(false);
    abierta.value = true; await nextTick();
    abierta.value = false; await nextTick();     // cerrada desde la interfaz
    const otra = vi.fn(); pushView(otra);
    atras();
    expect(otra).toHaveBeenCalledTimes(1);
  });
});

describe('dictado (web)', () => {
  let instancia;
  class Reconocedor {
    constructor() { instancia = this; this.iniciado = 0; this.parado = 0; this.abortado = 0; }
    start() { this.iniciado++; }
    stop() { this.parado++; }
    abort() { this.abortado++; }
  }
  const resultado = (...tramos) => ({ resultIndex: 0, results: tramos.map(([texto, final]) => Object.assign([{ transcript: texto }], { isFinal: final })) });
  async function cargar(conSoporte = true) {
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));
    if (conSoporte) window.webkitSpeechRecognition = Reconocedor; else { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; }
    return import('../src/native/speech.js');
  }
  const manejadores = () => ({ onPartial: vi.fn(), onFinal: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });
  afterEach(() => { vi.doUnmock('@capacitor/core'); delete window.webkitSpeechRecognition; });

  it('sin reconocedor en el navegador, no hay dictado', async () => {
    const m = await cargar(false);
    expect(m.dictationSupported).toBe(false);
    await expect(m.createDictation({}).start()).rejects.toThrow('no soporta dictado');
  });

  it('arranca en español, con parciales, y continuo salvo que se pida lo contrario', async () => {
    const m = await cargar();
    expect(m.dictationSupported).toBe(true);
    await m.createDictation(manejadores()).start();
    expect(instancia.lang).toMatch(/^es/);
    expect(instancia.interimResults).toBe(true);
    expect(instancia.continuous).toBe(true);
    await m.createDictation(manejadores(), { continuous: false }).start();
    expect(instancia.continuous).toBe(false);
  });

  it('cada parcial trae el acumulado de la sesión, no un delta', async () => {
    const m = await cargar();
    const h = manejadores();
    await m.createDictation(h).start();
    instancia.onresult(resultado(['el paciente ', true], ['refiere', false]));
    expect(h.onPartial).toHaveBeenLastCalledWith('el paciente refiere');
    instancia.onresult(resultado(['refiere prurito', true]));
    expect(h.onPartial).toHaveBeenLastCalledWith('el paciente refiere prurito');
  });

  it('al terminar entrega el texto definitivo una sola vez', async () => {
    const m = await cargar();
    const h = manejadores();
    const s = m.createDictation(h);
    await s.start();
    instancia.onresult(resultado(['hola ', true], ['a medias', false]));
    await s.stop();
    expect(instancia.parado).toBe(1);
    instancia.onend(); instancia.onend();
    expect(h.onFinal).toHaveBeenCalledTimes(1);
    expect(h.onFinal).toHaveBeenCalledWith('hola');     // lo no confirmado no entra
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  it('sin permiso de micrófono lo dice; el silencio no es un error', async () => {
    const m = await cargar();
    const h = manejadores();
    await m.createDictation(h).start();
    instancia.onerror({ error: 'no-speech' });
    instancia.onerror({ error: 'aborted' });
    expect(h.onError).not.toHaveBeenCalled();
    instancia.onerror({ error: 'not-allowed' });
    expect(h.onError.mock.calls[0][0].message).toBe('Necesito permiso de micrófono para dictar.');
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  it('dispose suelta el micrófono y deja de escuchar eventos', async () => {
    const m = await cargar();
    const s = m.createDictation(manejadores());
    await s.start();
    const rec = instancia;
    s.dispose();
    expect(rec.abortado).toBe(1);
    expect(rec.onresult).toBeNull();
    expect(() => s.dispose()).not.toThrow();
  });
});
