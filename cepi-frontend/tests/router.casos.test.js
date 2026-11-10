import { describe, it, expect } from 'vitest';
import { casosAllowedHere } from '../src/router.js';

// Telemedicina y casos son plataformas distintas: desde telemedicina no se entra a casos.
describe('casosAllowedHere', () => {
  it('telemedicina.cepi.ec no deja entrar a casos', () => {
    expect(casosAllowedHere('telemedicina.cepi.ec')).toBe(false);
  });
  it('casos.cepi.ec y local sí', () => {
    expect(casosAllowedHere('casos.cepi.ec')).toBe(true);
    expect(casosAllowedHere('127.0.0.1')).toBe(true);
  });
});
