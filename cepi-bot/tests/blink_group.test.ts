/**
 * BLINK ficha group — cribado de malignidad, antes de §4 Examen físico.
 *
 * Verifies the group's position in FICHA_GROUP_SPEC and the autocalculated
 * score / result written to the episode on submit.
 */
import { describe, it, expect } from 'vitest';
import { handleV1Flow, FICHA_GROUPS } from '../src/flowV1.js';
import { emptySession } from '../src/sessionStore.js';

function fakeMcp() {
  const calls: Array<{ name: string; args: any }> = [];
  return {
    calls,
    get jwt() { return 'test-jwt'; },
    get apiKey() { return ''; },
    get apiUrl() { return 'http://localhost:3001'; },
    async connect() {},
    async close() {},
    async call(name: string, args: any) {
      calls.push({ name, args });
      if (name === 'entities.create') return { ok: true, data: { id: 'new-id' } };
      if (name === 'entities.update') return { ok: true, data: { id: args.id } };
      if (name === 'entities.get') return { ok: true, data: { id: args.id, data: {} } };
      if (name === 'entities.list') return { ok: true, data: [] };
      return { ok: false, error: `unknown ${name}` };
    },
  } as any;
}

function fichaSession() {
  const s: any = { id: 'sess-1', ...emptySession('u1') };
  s.active_patient_id = 'pat-1';
  s.active_episode_id = 'ep-1';
  s.extracted_slots = { mode: 'patient', form_state: { kind: 'ficha' } };
  return s;
}

/** Submit the BLINK form and return the data persisted via entities.update. */
async function submitBlink(data: Record<string, unknown>) {
  const mcp = fakeMcp();
  const session = fichaSession();
  await handleV1Flow({
    session, message: '', mcp,
    formSubmission: { form_id: 'ficha_grp_g_blink', data },
  });
  const upd = mcp.calls.find((c: any) => c.name === 'entities.update' && c.args.id === 'ep-1');
  return upd?.args?.data as Record<string, unknown> | undefined;
}

describe('BLINK ficha group', () => {
  it('g_blink sits between g_3_7 and g_4_1 (before Examen físico)', () => {
    const ids = FICHA_GROUPS.map(g => g.id);
    expect(ids.indexOf('g_blink')).toBe(ids.indexOf('g_3_7') + 1);
    expect(ids.indexOf('g_4_1')).toBe(ids.indexOf('g_blink') + 1);
  });

  it('is a single episode form with the 5 BLINK questions', () => {
    const g = FICHA_GROUPS.find(x => x.id === 'g_blink')!;
    expect(g.label).toBe('BLINK');
    expect(g.target).toBe('episode');
    expect(g.fields.map(f => f.key)).toEqual([
      'blink_benigna', 'blink_lonely', 'blink_irregular',
      'blink_nervios_cambios', 'blink_known_clues',
    ]);
  });

  it('≥2 points → sugiere malignidad / biopsia', async () => {
    const data = await submitBlink({
      blink_benigna: false, blink_lonely: true, blink_irregular: true,
      blink_nervios_cambios: false, blink_known_clues: false,
    });
    expect(data?.blink_total).toBe(2);
    expect(String(data?.blink_resultado)).toMatch(/malignidad/i);
    expect(String(data?.blink_resultado)).toMatch(/biopsia/i);
  });

  it('0–1 point → sugiere benignidad', async () => {
    const data = await submitBlink({
      blink_benigna: false, blink_lonely: true, blink_irregular: false,
      blink_nervios_cambios: false, blink_known_clues: false,
    });
    expect(data?.blink_total).toBe(1);
    expect(String(data?.blink_resultado)).toMatch(/benignidad/i);
  });

  it('B = Sí → benigna evidente, no precisa más estudios', async () => {
    const data = await submitBlink({
      blink_benigna: true, blink_lonely: true, blink_irregular: true,
      blink_nervios_cambios: true, blink_known_clues: true,
    });
    expect(data?.blink_total).toBe(4);
    expect(String(data?.blink_resultado)).toMatch(/no precisa más estudios/i);
  });
});

describe('envío de una sección que el backend rechaza', () => {
  it('no queda en la conversación como dato de la ficha (sin el 📋)', async () => {
    const mcp = fakeMcp();
    const call = mcp.call.bind(mcp);
    mcp.call = async (name: string, args: any) =>
      name === 'entities.update' && args.id === 'ep-1' && args.data?.blink_lonely !== undefined
        ? { ok: false, error: 'HTTP 400: Validation failed' } : call(name, args);
    const session = fichaSession();
    const r: any = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: { form_id: 'ficha_grp_g_blink', data: { blink_lonely: true } },
    });
    expect(r.text).toContain('No pude guardar');
    const dicho = session.turns.filter((t: any) => t.role === 'user').map((t: any) => String(t.content));
    expect(dicho.some((c: string) => c.startsWith('📋'))).toBe(false);
    expect(dicho.at(-1)).toMatch(/^⚠️ No guardado — BLINK/);
  });
});
