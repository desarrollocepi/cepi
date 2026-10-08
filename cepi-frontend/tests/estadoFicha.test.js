import { describe, it, expect } from 'vitest';
import { ESTADOS_FICHA, estadoFicha, normalizar } from '../src/estadoFicha.js';

// La tabla de PAPER §24.2.1. Si cambia acá tiene que cambiar en `EstadoFicha.swift` y
// `EstadoFicha.kt`: los tres pintan el mismo LED.
const TABLA = [
  ['respondida', 'Respondida', '#16A34A'],
  ['en_revisión_solicitada', 'Revisión solicitada', '#DC2626'],
  ['derivada', 'Derivada', '#F59E0B'],
  ['en_triage', 'En triaje', '#06B6D4'],
  ['enviada', 'Enviada al turno', '#8B5CF6'],
  ['en_curso', 'En curso', '#2563EB'],
  ['agendado', 'Agendada', '#64748B'],
  ['cerrado', 'Cerrada', '#9CA3AF'],
];

describe('estadoFicha', () => {
  it.each(TABLA)('«%s» es %s, con su color', (valor, etiqueta, color) => {
    const e = estadoFicha(valor);
    expect(e.etiqueta).toBe(etiqueta);
    expect(e.color).toBe(color);
    expect(e.hueco).toBeFalsy();
  });

  it('el orden de la lista es el de la tabla, con "otro" y "sin consulta" al final', () => {
    expect(ESTADOS_FICHA.map((e) => e.valor)).toEqual([...TABLA.map((t) => t[0]), null, null]);
    expect(ESTADOS_FICHA.map((e) => e.orden)).toEqual(ESTADOS_FICHA.map((_, i) => i));
    expect(ESTADOS_FICHA.at(-2).id).toBe('otro');
    expect(ESTADOS_FICHA.at(-1).id).toBe('sin_consulta');
  });

  it.each([undefined, null, '', '   '])('sin estado (%j) es "Sin consulta", con el LED hueco', (valor) => {
    const e = estadoFicha(valor);
    expect(e.id).toBe('sin_consulta');
    expect(e.hueco).toBe(true);
  });

  it('un valor desconocido no rompe: cae en "Otro estado"', () => {
    expect(estadoFicha('algo_nuevo').id).toBe('otro');
    expect(estadoFicha(42).id).toBe('sin_consulta');
  });
});

describe('normalizar', () => {
  it('quita mayúsculas y tildes', () => {
    expect(normalizar('José Ñandú PÉREZ')).toBe('jose nandu perez');
  });
  it('aguanta vacíos', () => {
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});
