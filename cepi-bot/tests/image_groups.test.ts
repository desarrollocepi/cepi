/**
 * §4.7 (Imágenes Lesión) and §8 (Imágenes Consentimiento) ficha groups.
 *
 * Exercises handleV1Flow's image-group submit path with a fake MCP client
 * and a stubbed cepi-isic /inspect endpoint (via global.fetch). Verifies:
 *   - the new groups appear in FICHA_GROUP_SPEC, in the right position
 *   - §4.7 inspects each image, skips inadequate ones, flags faces private
 *   - §8 creates a consent record per image, no inspection
 *   - both write the records directly on submit (no confirmation gate)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleV1Flow, FICHA_GROUPS } from '../src/flowV1.js';
import { emptySession } from '../src/sessionStore.js';

const CLINICAL_IMAGE_ENTITY_ID = '16000000-0000-0000-0000-000000000000';
const CONSENT_ENTITY_ID = '18000000-0000-0000-0000-000000000000';

/** Fake MCP client — records calls, returns ok for the usual tools. */
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

/** A session already inside the ficha flow with patient + episode active. */
function fichaSession() {
  const s: any = { id: 'sess-1', ...emptySession('u1') };
  s.active_patient_id = 'pat-1';
  s.active_episode_id = 'ep-1';
  s.extracted_slots = { mode: 'patient', form_state: { kind: 'ficha' } };
  return s;
}

describe('ficha image groups — spec', () => {
  it('g_4_7 sits right after g_4_6', () => {
    const ids = FICHA_GROUPS.map(g => g.id);
    expect(ids.indexOf('g_4_7')).toBe(ids.indexOf('g_4_6') + 1);
  });
  it('g_8 sits right after g_7, and g_8_2 right after g_8', () => {
    const ids = FICHA_GROUPS.map(g => g.id);
    expect(ids.indexOf('g_8')).toBe(ids.indexOf('g_7') + 1);
    expect(ids.indexOf('g_8_2')).toBe(ids.indexOf('g_8') + 1);
  });
  it('g_4_7 has a multiple image_upload field on the episode', () => {
    const g = FICHA_GROUPS.find(x => x.id === 'g_4_7')!;
    expect(g.target).toBe('episode');
    expect(g.fields[0].type).toBe('image_upload');
    expect(g.fields[0].multiple).toBe(true);
  });
  it('g_8 has a single image_upload field on the patient', () => {
    const g = FICHA_GROUPS.find(x => x.id === 'g_8')!;
    expect(g.target).toBe('patient');
    expect(g.fields[0].type).toBe('image_upload');
  });
});

describe('§4.7 Imágenes Lesión submit', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubInspect(byId: Record<string, any>) {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      const r = byId[body.attachment_id] || { adequate: false, reasons: ['unknown'], has_face: false };
      return { ok: true, json: async () => ({ attachment_id: body.attachment_id, ...r }) };
    }));
  }

  it('creates clinical_image records for adequate images and flags faces private', async () => {
    stubInspect({
      'aaaaaaaa-0000-0000-0000-000000000001': { adequate: true, width: 800, height: 600, has_face: false },
      'aaaaaaaa-0000-0000-0000-000000000002': { adequate: true, width: 800, height: 600, has_face: true },
    });
    const mcp = fakeMcp();
    const session = fichaSession();
    const res = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: {
        form_id: 'ficha_grp_g_4_7',
        data: {
          imagenes_lesion:
            'aaaaaaaa-0000-0000-0000-000000000001,aaaaaaaa-0000-0000-0000-000000000002',
        },
      },
    });
    expect(res).not.toBeNull();
    // Written directly on submit — no confirmation gate.
    expect(session.pending_action).toBeNull();
    const creates = mcp.calls.filter((c: any) => c.name === 'entities.create');
    expect(creates.length).toBe(2);
    for (const c of creates) {
      expect(c.args.entity_id).toBe(CLINICAL_IMAGE_ENTITY_ID);
      expect(c.args.data.embedding_status).toBe('pending');
      expect(c.args.data.field_key).toBe('lesion');
      // linked to both episode and patient
      expect(c.args.data['12000000-0000-0000-0000-000000000000:episode_id']).toBe('ep-1');
      expect(c.args.data['11000000-0000-0000-0000-000000000000:patient_id']).toBe('pat-1');
    }
    // second image had a face → privada true
    expect(creates[1].args.data.privada).toBe(true);
    expect(creates[0].args.data.privada).toBe(false);
    expect(res!.text).toMatch(/privada/i);
  });

  it('skips inadequate images and reports the reason', async () => {
    stubInspect({
      'bbbbbbbb-0000-0000-0000-000000000001': { adequate: true, width: 800, height: 600, has_face: false },
      'bbbbbbbb-0000-0000-0000-000000000002':
        { adequate: false, reasons: ['imagen sobreexpuesta (brillo medio 240/255)'], has_face: false },
    });
    const mcp = fakeMcp();
    const session = fichaSession();
    const res = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: {
        form_id: 'ficha_grp_g_4_7',
        data: {
          imagenes_lesion:
            'bbbbbbbb-0000-0000-0000-000000000001,bbbbbbbb-0000-0000-0000-000000000002',
        },
      },
    });
    const creates = mcp.calls.filter((c: any) => c.name === 'entities.create');
    expect(creates.length).toBe(1);
    expect(res!.text).toMatch(/sobreexpuesta|descartada/i);
  });

  it('does not stage anything when every image fails inspection', async () => {
    stubInspect({
      'cccccccc-0000-0000-0000-000000000001':
        { adequate: false, reasons: ['resolución insuficiente'], has_face: false },
    });
    const mcp = fakeMcp();
    const session = fichaSession();
    const res = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: {
        form_id: 'ficha_grp_g_4_7',
        data: { imagenes_lesion: 'cccccccc-0000-0000-0000-000000000001' },
      },
    });
    expect(session.pending_action).toBeNull();
    expect(res!.text).toMatch(/control de calidad/i);
  });
});

describe('§8 Imágenes Consentimiento submit', () => {
  it('creates a consent record linked to the patient, no inspection', async () => {
    const mcp = fakeMcp();
    const session = fichaSession();
    const res = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: {
        form_id: 'ficha_grp_g_8',
        data: { imagen_consentimiento: 'dddddddd-0000-0000-0000-000000000001' },
      },
    });
    expect(res).not.toBeNull();
    // Written directly on submit — no confirmation gate.
    expect(session.pending_action).toBeNull();
    const creates = mcp.calls.filter((c: any) => c.name === 'entities.create');
    expect(creates.length).toBe(1);
    expect(creates[0].args.entity_id).toBe(CONSENT_ENTITY_ID);
    expect(creates[0].args.data.tipo).toBe('informado');
    expect(creates[0].args.data['11000000-0000-0000-0000-000000000000:patient_id']).toBe('pat-1');
    // La foto va en attachment_id: `documento` (tipo attachment) no tiene columna.
    expect(creates[0].args.data.attachment_id).toBe('dddddddd-0000-0000-0000-000000000001');
    expect(res!.text).toMatch(/consentimiento informado/);
  });

  it('g_8_2 crea el consentimiento de privacidad de los datos', async () => {
    const mcp = fakeMcp();
    const session = fichaSession();
    const res = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: {
        form_id: 'ficha_grp_g_8_2',
        data: { imagen_privacidad: 'eeeeeeee-0000-0000-0000-000000000001,eeeeeeee-0000-0000-0000-000000000002' },
      },
    });
    expect(session.pending_action).toBeNull();
    const creates = mcp.calls.filter((c: any) => c.name === 'entities.create');
    expect(creates.map((c: any) => c.args.data.tipo)).toEqual(['privacidad_datos', 'privacidad_datos']);
    expect(creates.map((c: any) => c.args.data.attachment_id)).toEqual([
      'eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002']);
    expect(res!.text).toMatch(/privacidad de los datos/);
  });

  it('rejects an empty submission', async () => {
    const mcp = fakeMcp();
    const session = fichaSession();
    const res = await handleV1Flow({
      session, message: '', mcp,
      formSubmission: { form_id: 'ficha_grp_g_8', data: {} },
    });
    expect(session.pending_action).toBeNull();
    expect(res!.text).toMatch(/ninguna imagen/i);
  });
});
