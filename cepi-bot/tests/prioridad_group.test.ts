/**
 * Prioridad clínica (PAPER §34): reemplaza al BLINK en la ficha, en el mismo lugar
 * (entre 3.7 y 4.1). BLINK ya no se pregunta.
 */
import { describe, it, expect } from 'vitest';
import { handleV1Flow, FICHA_GROUPS, PRIORIDADES } from '../src/flowV1.js';
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

describe('prioridad clínica en la ficha', () => {
  it('g_prioridad ocupa el lugar del BLINK, que ya no se pregunta', () => {
    const ids = FICHA_GROUPS.map(g => g.id);
    expect(ids).not.toContain('g_blink');
    expect(ids.indexOf('g_prioridad')).toBe(ids.indexOf('g_3_7') + 1);
    expect(ids.indexOf('g_4_1')).toBe(ids.indexOf('g_prioridad') + 1);
  });

  it('es un formulario del episodio: la guía arriba y las tres opciones', () => {
    const g = FICHA_GROUPS.find(x => x.id === 'g_prioridad')!;
    expect(g.label).toBe('3.8 Prioridad clínica');
    expect(g.target).toBe('episode');
    expect(g.fields[0].type).toBe('heading');
    expect(g.fields[0].label).toMatch(/Urgente: .*supervisor/);
    expect(g.fields[1]).toMatchObject({ key: 'prioridad', type: 'radio', options: ['Urgente', 'Preferente', 'Programada'] });
    expect(PRIORIDADES).toEqual(['Urgente', 'Preferente', 'Programada']);
  });

  it('guardar escribe la prioridad en el episodio', async () => {
    const mcp = fakeMcp();
    await handleV1Flow({
      session: fichaSession(), message: '', mcp,
      formSubmission: { form_id: 'ficha_grp_g_prioridad', data: { prioridad: 'Preferente' } },
    });
    const upd = mcp.calls.find((c: any) => c.name === 'entities.update' && c.args.id === 'ep-1');
    expect(upd?.args?.data?.prioridad).toBe('Preferente');
  });
});

describe('envío de una sección que el backend rechaza', () => {
  it('no queda en la conversación como dato de la ficha (sin el 📋)', async () => {
    const mcp = fakeMcp();
    const call = mcp.call.bind(mcp);
    mcp.call = async (name: string, args: any) =>
      name === 'entities.update' && args.id === 'ep-1' && args.data?.prioridad !== undefined
        ? { ok: false, error: 'HTTP 400: Validation failed' } : call(name, args);
    const session = fichaSession();
    const r: any = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: { form_id: 'ficha_grp_g_prioridad', data: { prioridad: 'Urgente' } },
    });
    expect(r.text).toContain('No pude guardar');
    const dicho = session.turns.filter((t: any) => t.role === 'user').map((t: any) => String(t.content));
    expect(dicho.some((c: string) => c.startsWith('📋'))).toBe(false);
    expect(dicho.at(-1)).toMatch(/^⚠️ No guardado — 3\.8 Prioridad clínica/);
  });
});
