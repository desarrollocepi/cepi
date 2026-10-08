import { describe, it, expect } from 'vitest';
import { edadDesde } from '../src/edad.js';

const el = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

describe('edadDesde', () => {
  it('los tests corren con la hora de Ecuador', () => {
    expect(new Date('2026-10-08T12:00:00Z').getTimezoneOffset()).toBe(300);
  });

  it('la víspera del cumpleaños todavía no cumplió', () => {
    expect(edadDesde('1990-10-09', el(2026, 10, 8))).toBe(35);
    expect(edadDesde('1990-10-09', el(2026, 10, 8, 23))).toBe(35);
  });

  it('el día del cumpleaños ya cumplió, desde la primera hora', () => {
    expect(edadDesde('1990-10-09', el(2026, 10, 9, 0))).toBe(36);
  });

  it('acepta la fecha con hora (como la manda el backend)', () => {
    expect(edadDesde('1990-10-09T00:00:00.000Z', el(2026, 10, 8))).toBe(35);
  });

  it('un recién nacido tiene 0', () => {
    expect(edadDesde('2026-10-01', el(2026, 10, 8))).toBe(0);
  });

  it.each([null, undefined, '', 'ayer', '1990-13-40', '2030-01-01', '1800-01-01'])('sin fecha válida (%j) no inventa una edad', (v) => {
    expect(edadDesde(v, el(2026, 10, 8))).toBeNull();
  });
});
