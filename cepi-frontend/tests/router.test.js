import { describe, it, expect } from 'vitest';
import { router, inicioSegunHost } from '../src/router.js';

const resolver = (ruta) => router.resolve(ruta);

describe('router', () => {
  it('el paciente abierto va en la URL, con la sección salvo Chat', () => {
    expect(resolver('/chat').name).toBe('chat');
    const r = resolver('/chat/abc-123');
    expect(r.name).toBe('chat-paciente');
    expect(r.params.patientId).toBe('abc-123');
    expect(r.params.seccion).toBeFalsy();
    expect(resolver('/chat/abc-123/ficha').params.seccion).toBe('ficha');
    expect(resolver('/chat/abc-123/imagenes').params.seccion).toBe('imagenes');
  });

  it('una sección que no existe no abre al paciente: cae al catch-all', () => {
    expect(resolver('/chat/abc-123/otra').name).not.toBe('chat-paciente');
  });

  it('armar la ruta de un paciente da el enlace compartible', () => {
    expect(resolver({ name: 'chat-paciente', params: { patientId: 'p1' } }).href).toBe('#/chat/p1');
    expect(resolver({ name: 'chat-paciente', params: { patientId: 'p1', seccion: 'ficha' } }).href).toBe('#/chat/p1/ficha');
  });

  it('casos: el caso y el paciente son rutas propias', () => {
    expect(resolver('/casos/caso/e1').params.episodeId).toBe('e1');
    expect(resolver('/casos/paciente/p1').params.patientId).toBe('p1');
  });

  it('todas las pantallas piden sesión', () => {
    for (const ruta of ['/chat', '/chat/p1', '/casos', '/casos/caso/e1', '/galeria', '/perfil']) {
      expect(resolver(ruta).meta.auth, ruta).toBe(true);
    }
  });

  it('sin ruta se entra a telemedicina (el dominio de casos entra al portal)', () => {
    expect(inicioSegunHost()).toBe('/chat');
  });
});
