import { describe, it, expect } from 'vitest';
import { buildAnswerBatch, ESTADOS_CON_INTERCONSULTA } from '../src/interconsulta.js';

const base = { episodeId: 'ep1', userId: 'derma1', today: '2026-11-09' };

describe('buildAnswerBatch — respuesta a la interconsulta', () => {
  it('guarda en la ficha, apaga la campana y avisa al primario', () => {
    const b = buildAnswerBatch({
      ...base, primarioId: 'prim1', recomendacion: ' Exéresis y control en 6 meses ',
      diagnostico: 'D22.5 — Nevus atípico', tratamiento: 'Exéresis completa', observaciones: 'Cambió de color',
    });
    expect(b.map((s) => s.tool)).toEqual(['entities.update', 'entities.complete_review', 'reminders.create']);
    expect(b[0].args).toEqual({ id: 'ep1', record_type: 'business', data: {
      recomendacion: 'Exéresis y control en 6 meses', recomendacion_por: 'derma1', recomendacion_at: '2026-11-09',
      estado: 'respondida', diagnostico: 'D22.5 — Nevus atípico', tratamiento_resumen: 'Exéresis completa',
      observaciones: 'Cambió de color',
    } });
    expect(b[1].args).toMatchObject({ entity_id: 'ep1' });
    expect(b[2].args).toMatchObject({ owner_user_id: 'prim1', title: 'Respuesta a tu teleconsulta' });
    expect(String(b[2].args.message)).toContain('Diagnóstico: D22.5 — Nevus atípico');
  });

  it('un campo vacío no borra lo que la ficha ya tenía', () => {
    const [upd] = buildAnswerBatch({ ...base, recomendacion: 'Ver en consulta', diagnostico: '  ', tratamiento: null });
    const data = upd.args.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('diagnostico');
    expect(data).not.toHaveProperty('tratamiento_resumen');
    expect(data).not.toHaveProperty('observaciones');
  });

  it('sin primario no hay aviso, pero la campana se apaga igual', () => {
    const b = buildAnswerBatch({ ...base, recomendacion: 'ok' });
    expect(b.map((s) => s.tool)).toEqual(['entities.update', 'entities.complete_review']);
  });

  it('exige la respuesta', () => {
    expect(() => buildAnswerBatch({ ...base, recomendacion: '   ' })).toThrow(/respuesta/);
  });

  it('los estados que esperan especialista', () => {
    expect(ESTADOS_CON_INTERCONSULTA).toEqual(['enviada', 'en_triage', 'derivada', 'en_revisión_solicitada']);
  });
});
