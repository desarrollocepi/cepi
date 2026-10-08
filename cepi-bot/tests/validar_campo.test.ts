/**
 * Validación de respuestas a campos con tipo: determinista → IA → «no entendí».
 * Regresión: «1 enero 2000» en la fecha de nacimiento terminaba en un error 400
 * del backend al guardar la sección.
 */
import { describe, it, expect } from 'vitest';
import { normalizarFecha, normalizarNumero, tipoEsperado, validarConIA, validarRespuesta } from '../src/validarCampo.js';
import { handleV1Flow } from '../src/flowV1.js';
import { emptySession } from '../src/sessionStore.js';

const FECHA = { key: 'fecha_nac', type: 'date' as const };
const EDAD = { key: 'edad' };
/** Un LLM de mentira que contesta lo que se le diga y recuerda qué le llegó. */
const llmQueDice = (texto: string) => {
  const visto: any[] = [];
  return { visto, name: 'falso', async step(h: any[]) { visto.push(h); return { kind: 'message' as const, text: texto }; } };
};

describe('normalizarFecha (determinista)', () => {
  it('entiende las formas en que se escribe una fecha', () => {
    for (const t of ['1 enero 2000', '1 de enero de 2000', '01/01/2000', '1-1-2000', '2000-01-01', '1 ene 2000',
      'Enero 1, 2000', '1 de enero del 2000', '01.01.2000', '1/1/00']) {
      expect(normalizarFecha(t), t).toBe('2000-01-01');
    }
    expect(normalizarFecha('13 marzo 2000')).toBe('2000-03-13');
    expect(normalizarFecha('15/03/90')).toBe('1990-03-15');           // dos cifras: no en el futuro
  });

  it('día primero, como se escribe acá', () => {
    expect(normalizarFecha('03/04/2001')).toBe('2001-04-03');
  });

  it('rechaza lo que no es una fecha real o inequívoca', () => {
    for (const t of ['ayer', 'no sé', '31/02/2000', '2000', 'enero', '32 enero 2000', '1 enero 1850', '']) {
      expect(normalizarFecha(t), t).toBeNull();
    }
  });
});

describe('normalizarNumero (determinista)', () => {
  it('entiende cifras con o sin unidad', () => {
    expect(normalizarNumero('35')).toBe(35);
    expect(normalizarNumero('35 años')).toBe(35);
    expect(normalizarNumero('1,5')).toBe(1.5);
    expect(normalizarNumero('treinta y cinco')).toBeNull();
  });
});

describe('la regla: determinista, después IA, y si no, no se entendió', () => {
  it('el texto libre no se valida', async () => {
    expect(tipoEsperado({ key: 'direccion' })).toBeNull();
    expect(await validarRespuesta({ key: 'direccion' }, 'Av. Uno')).toEqual({ ok: true, value: 'Av. Uno' });
  });

  it('si el determinista lo entiende, la IA ni se llama', async () => {
    const llm = llmQueDice('1999-01-01');
    expect(await validarRespuesta(FECHA, '1 enero 2000', llm)).toEqual({ ok: true, value: '2000-01-01' });
    expect(llm.visto).toHaveLength(0);
  });

  it('si no, pasa a la IA, que solo recibe la respuesta y el tipo', async () => {
    const llm = llmQueDice('2000-01-01');
    // `porIA`: quien conversa tiene que confirmarlo antes de guardarlo.
    expect(await validarRespuesta(FECHA, 'el primero de enero del dos mil', llm)).toEqual({ ok: true, value: '2000-01-01', porIA: true });
    expect(llm.visto[0].map((t: any) => t.role)).toEqual(['system', 'user']);
    expect(llm.visto[0][1].content).toBe('el primero de enero del dos mil');
  });

  it('si la IA tampoco lo entiende, o contesta otra cosa, no se entendió', async () => {
    expect(await validarRespuesta(FECHA, 'cuando llovía', llmQueDice('NO'))).toEqual({ ok: false });
    expect(await validarRespuesta(FECHA, 'cuando llovía', llmQueDice('Claro, la fecha es 2000-01-01.'))).toEqual({ ok: false });
    expect(await validarRespuesta(FECHA, 'cuando llovía', llmQueDice('2000-02-31'))).toEqual({ ok: false });
  });

  it('una IA caída no rompe: no se entendió', async () => {
    const roto = { name: 'roto', async step() { throw new Error('sin red'); } };
    expect(await validarConIA(FECHA, 'cuando llovía', roto as any)).toEqual({ ok: false });
  });

  it('números: igual', async () => {
    expect(await validarRespuesta(EDAD, '35 años')).toEqual({ ok: true, value: 35 });
    expect(await validarRespuesta(EDAD, 'treinta y cinco', llmQueDice('35'))).toEqual({ ok: true, value: 35, porIA: true });
  });
});

describe('legible', () => {
  it('dice la fecha como la diría una persona, para confirmarla', async () => {
    const { legible } = await import('../src/validarCampo.js');
    expect(legible('fecha', '2026-01-01')).toBe('1 de enero de 2026');
    expect(legible('numero', 35)).toBe('35');
  });
});

describe('el cerebro normaliza la fecha antes de guardar', () => {
  it('una sección enviada con «1 enero 2000» guarda 2000-01-01', async () => {
    const calls: any[] = [];
    const mcp: any = { async call(name: string, args: any) {
      calls.push({ name, args });
      if (name === 'entities.get') return { ok: true, data: { id: args.id, data: {} } };
      if (name === 'entities.list') return { ok: true, data: [] };
      return { ok: true, data: { id: args.id || 'x' } };
    } };
    const s: any = { id: 'sess-1', ...emptySession('u1') };
    s.active_patient_id = 'pat-1'; s.active_episode_id = 'ep-1';
    s.extracted_slots = { mode: 'patient', form_state: { kind: 'ficha' } };
    await handleV1Flow({ session: s, message: '', mcp,
      formSubmission: { form_id: 'ficha_grp_g_1_2', data: { fecha_nac: '1 enero 2000' } } });
    const upd = calls.find(c => c.name === 'entities.update' && c.args.id === 'pat-1');
    expect(upd.args.data.fecha_nac).toBe('2000-01-01');
  });
});
