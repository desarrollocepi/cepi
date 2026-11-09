/** Alta del paciente (PAPER §35). */
import { describe, it, expect } from 'vitest';
import { buildDischargeBatch, dischargeBlockReason, hoyEcuador } from '../src/alta.js';

describe('alta', () => {
  it('pone estado alta con fecha y quién, apaga revisar y deja nota', () => {
    const b = buildDischargeBatch({ episodeId: 'ep1', userId: 'u1', userName: 'Dra. Gaby', nota: 'Curada.', today: '2026-11-09' });
    expect(b.map(s => s.tool)).toEqual(['entities.update', 'entities.complete_review', 'chatter.add_note']);
    expect(b[0].args).toMatchObject({ id: 'ep1', data: { estado: 'alta', alta_at: '2026-11-09', alta_por: 'u1' } });
    expect(b[2].args.body).toBe('🏁 Alta dada por Dra. Gaby. Curada.');
  });
  it('sin nota ni nombre', () => {
    const b = buildDischargeBatch({ episodeId: 'ep1', userId: null, today: '2026-11-09' });
    expect((b[0].args as any).data.alta_por).toBeUndefined();
    expect(b[2].args.body).toBe('🏁 Alta dada por el médico.');
  });
  it('motivo de bloqueo', () => {
    expect(dischargeBlockReason({ estado: 'alta' })).toBe('Este paciente ya está de alta');
    expect(dischargeBlockReason({ estado: 'en_curso' })).toBeNull();
    expect(dischargeBlockReason(null)).toBe('No se encontró la consulta');
  });
  it('hoy en Ecuador: a las 03:00 UTC todavía es el día anterior', () => {
    expect(hoyEcuador(new Date('2026-11-10T03:00:00Z'))).toBe('2026-11-09');
  });
});
