/** Consentimientos del paciente (PAPER §31). */
import { describe, it, expect } from 'vitest';
import { buildConsentCreate, createConsents, listConsents, CONSENT_ENTITY_ID } from '../src/consentimientos.js';

function mcpWith(rows: any[]) {
  const calls: any[] = [];
  return {
    calls,
    async call(name: string, args: any) {
      calls.push({ name, args });
      if (name === 'entities.list') return { ok: true, data: rows };
      if (name === 'entities.create') return { ok: true, data: { id: `c-${calls.length}` } };
      return { ok: false, error: 'x' };
    },
  };
}

describe('consentimientos', () => {
  it('buildConsentCreate guarda la foto en attachment_id', () => {
    const c = buildConsentCreate('pat-1', 'privacidad_datos', 'abcdef12-0000', '2026-11-09');
    expect(c.entity_id).toBe(CONSENT_ENTITY_ID);
    expect(c.data).toMatchObject({
      '11000000-0000-0000-0000-000000000000:patient_id': 'pat-1',
      tipo: 'privacidad_datos', attachment_id: 'abcdef12-0000', firmado_at: '2026-11-09',
    });
  });

  it('listConsents separa por tipo, cuenta los viejos como informado y omite revocados', async () => {
    const mcp = mcpWith([
      { id: '1', tipo: 'informado', attachment_id: 'a1', firmado_at: '2026-11-01', created_by: 'u1' },
      { id: '2', tipo: 'privacidad_datos', attachment_id: 'a2', firmado_at: '2026-11-02' },
      { id: '3', tipo: 'imagen_clinica', firmado_at: '2026-10-01' },
      { id: '4', tipo: 'informado', attachment_id: 'a4', firmado_at: '2026-11-05' },
      { id: '5', tipo: 'informado', attachment_id: 'a5', revocado_at: '2026-11-06' },
      { id: '6', tipo: 'lopdp' },
    ]);
    const r = await listConsents(mcp, 'pat-1');
    expect(mcp.calls[0].args).toMatchObject({ type: CONSENT_ENTITY_ID, filter: { patient_id: 'pat-1' } });
    expect(r.informado.map(x => x.id)).toEqual(['4', '1', '3']);
    expect(r.informado[1]).toEqual({ id: '1', attachment_id: 'a1', fecha: '2026-11-01', subido_por: 'u1' });
    expect(r.informado[2].attachment_id).toBeNull();
    expect(r.privacidad_datos.map(x => x.id)).toEqual(['2']);
  });

  it('createConsents crea uno por foto', async () => {
    const mcp = mcpWith([]);
    const r = await createConsents(mcp, 'pat-1', 'informado', ['a', 'b']);
    expect(r.ids).toHaveLength(2);
    expect(mcp.calls.filter(c => c.name === 'entities.create')).toHaveLength(2);
  });
});
