/**
 * Anonimizado previo al envío a un LLM externo.
 *
 * Los casos salen de texto real de DrPro, con sus mayúsculas y sus faltas. Lo que
 * se prueba no es que "borre cosas", sino las dos mitades que importan: que quite
 * lo que reidentifica, Y que NO toque lo clínico — un anonimizador que se lleva por
 * delante «placa eritematosa» deja un texto seguro e inútil.
 */
import { describe, it, expect } from 'vitest';
import { anonimizarTextoClinico } from '../src/anonimizar.js';

const FECHA_EP = '2026-09-04';

describe('quita lo que reidentifica', () => {
  it('el nombre del profesional, que venía en el 100% de las fichas', () => {
    const { texto, sustituciones } = anonimizarTextoClinico(
      'FECHA DEL ESTUDIO HISTOPATOLOGICO: NOMBRE DEL PROFESIONAL: DR RAMIREZ/ PG CASTRO/ PG DELGADO', FECHA_EP);
    expect(texto).not.toMatch(/RAMIREZ|CASTRO|DELGADO/);
    expect(texto).toContain('<profesional>');
    expect(sustituciones.profesional).toBeGreaterThan(0);
  });

  it('títulos sueltos dentro de la prosa', () => {
    const { texto } = anonimizarTextoClinico('Paciente referida por la Dra. Pérez al servicio', FECHA_EP);
    expect(texto).not.toMatch(/Pérez/);
    expect(texto).toContain('<profesional>');
  });

  it('cédula, teléfono y correo', () => {
    const { texto, sustituciones } = anonimizarTextoClinico(
      'contacto 1707338909 tel 0983583021 correo paciente@gmail.com', FECHA_EP);
    expect(texto).toBe('contacto <cédula> tel <teléfono> correo <correo>');
    expect(sustituciones).toMatchObject({ cédula: 1, teléfono: 1, correo: 1 });
  });
});

describe('las fechas se vuelven distancias', () => {
  it('convierte dd/mm/yyyy en «hace N», que es lo que la ficha necesita', () => {
    const { texto } = anonimizarTextoClinico('biopsia Punch 31/07/2026', FECHA_EP);
    expect(texto).toMatch(/biopsia Punch hace \d+ (semanas|meses)/);
    expect(texto).not.toContain('31/07');
  });

  it('también en formato ISO y en letra', () => {
    expect(anonimizarTextoClinico('control 2026-08-14', FECHA_EP).texto).toMatch(/hace \d+ semanas/);
    expect(anonimizarTextoClinico('cirugía el 14 de agosto de 2026', FECHA_EP).texto).toMatch(/hace \d+ semanas/);
  });

  it('sin fecha de referencia no inventa una distancia', () => {
    expect(anonimizarTextoClinico('biopsia 31/07/2026', null).texto).toBe('biopsia <fecha>');
  });

  it('una fecha futura no se convierte en «hace»', () => {
    expect(anonimizarTextoClinico('control 2026-10-01', FECHA_EP).texto).toContain('en los próximos días');
  });
});

describe('no toca lo clínico, que es el motivo de enviar el texto', () => {
  it('conserva lesión, topografía y características', () => {
    const original = 'DERMATOSIS LOCALIZADA EN ROSTRO CARACTERIZADA POR UNA PAPULA EUCROMICA ' +
      'UNTUOSA AL TACTO DE ASPECTO CEREBRIFORME EN SIEN IZQUEIRDA. ADEMAS MACULAS ' +
      'HIPERCROMICAS MARRON CLARO Y OSCURO EN DORSO DE MANOS.';
    expect(anonimizarTextoClinico(original, FECHA_EP).texto).toBe(original);
  });

  it('«8 de largo» o «3 de diámetro» no son fechas', () => {
    const original = 'cicatriz lineal de 8 centimetros de largo, margen de 3 de diametro';
    expect(anonimizarTextoClinico(original, FECHA_EP).texto).toBe(original);
  });

  it('conserva el diagnóstico con su CIE-10', () => {
    const original = '(C44.7)Tumor maligno de la piel del miembro inferior';
    expect(anonimizarTextoClinico(original, FECHA_EP).texto).toBe(original);
  });

  it('no confunde una dosis con una cédula', () => {
    // 10 dígitos seguidos es cédula; «25 mg» o «3 mm» no deben tocarse.
    const original = 'Pregabalina 25 mg cada noche, margenes de 3 mm por 10 dias';
    expect(anonimizarTextoClinico(original, FECHA_EP).texto).toBe(original);
  });
});
