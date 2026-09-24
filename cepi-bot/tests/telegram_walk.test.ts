/**
 * Telegram adapter e2e tests (no network): boots the real webhook listener
 * via startTelegram() on a random port, mocks `fetch` so api.telegram.org
 * sends are captured and TodoERP auth endpoints answer locally, and drives
 * the adapter with synthetic webhook updates.
 *
 * Regression under test: tapping "➕ Nuevo paciente" must start a
 * field-by-field walk of the `patient_new` form. Before the fix the form
 * was degraded to plain text, so the user's next message (a bare cédula)
 * was routed as a normal turn and fell through to the brain's patient
 * SEARCH branch instead of creating the patient.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';

// ── Env must be set before importing the adapter ───────────────────────────
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
// La organización es obligatoria: sin ella el turno correría sin org activa,
// o sea sin estar limitado a nadie (PAPER §27.4).
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.TELEGRAM_WEBHOOK_PORT = '0';            // random free port
delete process.env.TELEGRAM_PUBLIC_URL;             // no webhook self-registration
delete process.env.TELEGRAM_WEBHOOK_SECRET;         // no secret check

import { startTelegram } from '../src/telegram.js';

/** A syntactically valid JWT whose payload carries a far-future exp. */
const fakeJwt = 'h.' +
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') +
  '.s';

/** Outbound sendMessage payloads captured from the mocked Telegram API. */
const sent: Array<{ chat_id: number; text: string; reply_markup?: any }> = [];

/** Chat-turn bodies the scripted brain received (message / form_submission). */
const inbound: any[] = [];

// ── fetch mock: Telegram API + TodoERP auth ────────────────────────────────
const realFetch = globalThis.fetch;
function mockFetch(): void {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      if (u.includes('/sendMessage')) sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }
    if (u.endsWith('/api/auth/login')) {
      return new Response(JSON.stringify({ token: fakeJwt }), { status: 200 });
    }
    if (u.endsWith('/api/auth/external/resolve')) {
      return new Response(JSON.stringify({ token: fakeJwt }), { status: 200 });
    }
    return realFetch(url, init);
  }) as typeof fetch;
}

// ── Scripted brain: mirrors the real flowV1 contract for this flow ─────────
// (intro/search texts match what `dev-chat.sh` shows against the live brain)
const PATIENT_NEW_FORM = {
  id: 'patient_new',
  title: 'Nuevo paciente',
  fields: [
    { key: 'cedula', label: 'Cédula', placeholder: 'Ej: 12345678', required: true },
    { key: 'nombre', label: 'Nombres', placeholder: 'Ej: Juan', required: true },
    { key: 'apellidos', label: 'Apellidos', placeholder: 'Ej: Pérez', required: true },
  ],
  submit_label: 'Crear paciente',
  submit_send: '/nuevo-paciente {cedula} || {nombre} || {apellidos}',
};

// A ficha section form (structured submit) used to exercise the field-index
// callback encoding and the whole-section context render.
const FICHA_FORM = {
  id: 'ficha_grp_g_2_1',
  title: '2.1 Antecedentes',
  submit_mode: 'structured',
  fields: [
    { key: 'fuma', label: '¿Fuma?', type: 'radio', options: [
      { label: 'Sí', value: true }, { label: 'No', value: false }] },
    { key: 'sexo', label: 'Sexo', type: 'radio', options: ['M', 'F', 'Otro'] },
  ],
  actions: [{ label: 'Omitir', send: 'omitir ficha' }],
};

/**
 * Toggles the scripted brain between the two real server configurations:
 *   gateOn=false → confirm gate OFF (default deploy): the /nuevo-paciente
 *     submit auto-executes and returns the created patient (no pending_action).
 *   gateOn=true  → confirm gate ON: the submit STAGES a pending_action and the
 *     server re-attaches the still-persisted patient_new form to the
 *     "¿Confirmas?" turn (the stale-form echo the adapter must not walk).
 */
let gateOn = false;

async function scriptedBrain({ body }: { body: any; headers?: Record<string, string> }) {
  inbound.push(body);
  const msg = String(body?.message || '');
  if (body?.form_submission?.form_id === 'ficha_grp_g_2_1') {
    return { status: 200, body: {
      ok: true, session_id: 'sess-1', text: 'Antecedentes guardados.',
      form: null, quick_replies: [], pending_action: null,
    } };
  }
  if (/^\/?\s*(nuevo|nuevo\s+paciente|crear\s+paciente)\s*$/i.test(msg)) {
    return { status: 200, body: {
      ok: true, session_id: 'sess-1',
      text: 'Completá los datos del nuevo paciente.',
      form: PATIENT_NEW_FORM, quick_replies: [], pending_action: null,
    } };
  }
  if (/^\/?\s*ficha$/i.test(msg)) {
    return { status: 200, body: {
      ok: true, session_id: 'sess-1', text: '2.1 Antecedentes:',
      form: FICHA_FORM, quick_replies: [], pending_action: null,
    } };
  }
  const npm = msg.match(/^\/?\s*nuevo-paciente\s+(.+?)\s*\|\|\s*(.+?)\s*\|\|\s*(.+)$/i);
  if (npm) {
    if (gateOn) {
      // Stale patient_new form echoed alongside the staged pending_action.
      return { status: 200, body: {
        ok: true, session_id: 'sess-1',
        text: `Crear paciente:\n  • Cédula: ${npm[1].trim()}\n\n¿Confirmas?`,
        form: PATIENT_NEW_FORM, quick_replies: [],
        pending_action: { summary: 'Crear paciente', tool: 'entities.create' },
      } };
    }
    return { status: 200, body: {
      ok: true, session_id: 'sess-1',
      text: `Listo, ${npm[2].trim()} ${npm[3].trim()} quedó registrado.`,
      active_patient_id: '11111111-2222-3333-4444-555555555555',
      status_header: `👤 ${npm[2].trim()} ${npm[3].trim()}`,
      form: null, quick_replies: [], pending_action: null,
    } };
  }
  if (/^confirmame$/i.test(msg)) {
    return { status: 200, body: {
      ok: true, session_id: 'sess-1', text: '¿Confirmas?', quick_replies: [],
      pending_action: { summary: 'Crear paciente X', tool: 'entities.create' },
    } };
  }
  // Anything else emulates flowV1's fallthrough: patient SEARCH (the bug path).
  return { status: 200, body: {
    ok: true, session_id: 'sess-1',
    text: `Sin coincidencias para "${msg}". Probá de nuevo o crea uno.`,
  } };
}

let server: ReturnType<typeof startTelegram>;
let base = '';

/**
 * POST one webhook update and wait for async processing to settle. The handler
 * acks (200) before processing, and a single turn can emit MORE than one send
 * (e.g. a walk's intro + first question), so we wait for the send count to
 * stop changing rather than for the first send — otherwise a follow-up
 * assertion could read state mid-turn.
 */
async function update(payload: any): Promise<void> {
  const before = sent.length;
  const r = await realFetch(`${base}/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(r.status).toBe(200);
  // Wait until at least one send landed AND the count has been stable for one
  // poll interval (quiescence), bounded by a hard cap.
  let last = -1;
  for (let i = 0; i < 150; i++) {
    if (sent.length > before && sent.length === last) break;
    last = sent.length;
    await new Promise(res => setTimeout(res, 15));
  }
}

const msgUpdate = (chatId: number, text: string) =>
  ({ message: { chat: { id: chatId }, from: { id: 4242 }, text } });
const tapUpdate = (chatId: number, data: string) =>
  ({ callback_query: { id: 'cb1', data, from: { id: 4242 }, message: { chat: { id: chatId } } } });
const photoUpdate = (chatId: number, caption?: string) =>
  ({ message: { chat: { id: chatId }, from: { id: 4242 },
    photo: [{ file_id: 'f1', file_unique_id: 'u1' }], ...(caption ? { caption } : {}) } });
/** A non-image media message (video) that carries only a caption, no text. */
const videoCaptionUpdate = (chatId: number, caption: string) =>
  ({ message: { chat: { id: chatId }, from: { id: 4242 },
    video: { file_id: 'v1' }, caption } });

const lastTo = (chatId: number) => sent.filter(s => s.chat_id === chatId).at(-1)!;
const labelsOf = (s: { reply_markup?: any }) =>
  (s?.reply_markup?.inline_keyboard || []).flat().map((b: any) => b.text);

/** Texts sent to one chat since index `from`. */
const textsTo = (chatId: number, from = 0) =>
  sent.slice(from).filter(s => s.chat_id === chatId).map(s => s.text);

beforeAll(async () => {
  mockFetch();
  server = startTelegram(scriptedBrain);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  server.close();
});

describe('telegram new-patient walk', () => {
  const CHAT = 1001;

  it('first contact shows the welcome menu (message swallowed)', async () => {
    await update(msgUpdate(CHAT, 'hola'));
    const texts = textsTo(CHAT);
    expect(texts.some(t => t.includes('¿Qué querés hacer?'))).toBe(true);
    expect(inbound.length).toBe(0);             // nothing reached the brain
  });

  it('tapping "nuevo paciente" starts the field-by-field walk', async () => {
    await update(tapUpdate(CHAT, 'nuevo paciente'));
    const texts = textsTo(CHAT);
    expect(texts.some(t => t.includes('Completá los datos del nuevo paciente.'))).toBe(true);
    expect(texts.some(t => t.includes('(1/3) Cédula'))).toBe(true);
    // The intro must NOT render the flat form ("Respondé con los datos…"):
    // that wording contradicts the one-by-one walk.
    expect(texts.some(t => t.includes('Respondé con los datos'))).toBe(false);
  });

  it('a bare cédula is captured by the walk, NOT routed to search (the bug)', async () => {
    const mark = sent.length;
    await update(msgUpdate(CHAT, '0999888777'));
    const texts = textsTo(CHAT, mark);
    expect(texts.some(t => t.includes('(2/3) Nombres'))).toBe(true);
    // Regression assertion: the cédula never reaches the brain as a turn.
    expect(inbound.some(b => b?.message === '0999888777')).toBe(false);
    expect(texts.some(t => t.includes('Sin coincidencias'))).toBe(false);
  });

  it('completing the walk submits /nuevo-paciente c || n || a and creates the patient', async () => {
    await update(msgUpdate(CHAT, 'Juan'));
    const mark = sent.length;
    await update(msgUpdate(CHAT, 'Pérez'));
    expect(inbound.some(b => b?.message === '/nuevo-paciente 0999888777 || Juan || Pérez')).toBe(true);
    const texts = textsTo(CHAT, mark);
    expect(texts.some(t => t.includes('Listo, Juan Pérez quedó registrado.'))).toBe(true);
  });
});

describe('telegram walk guards', () => {
  it('"cancelar" mid-walk abandons the walk and shows the menu', async () => {
    const CHAT = 1002;
    await update(msgUpdate(CHAT, 'hola'));                 // welcome menu
    await update(tapUpdate(CHAT, 'nuevo paciente'));       // walk starts
    const mark = sent.length;
    const before = inbound.length;
    await update(msgUpdate(CHAT, 'cancelar'));
    const texts = textsTo(CHAT, mark);
    expect(texts.some(t => t.includes('¿Qué querés hacer?'))).toBe(true);
    expect(inbound.some(b => b?.message === 'cancelar')).toBe(false);
    // Non-vacuous: the abandoned walk must reach the brain for NOTHING — no new
    // turn of any kind (no captured field answer, no /nuevo-paciente submit).
    expect(inbound.length).toBe(before);
  });

  it('"salir" and "menú" also abandon the walk', async () => {
    for (const word of ['salir', 'menú']) {
      const CHAT = word === 'salir' ? 10021 : 10022;
      await update(msgUpdate(CHAT, 'hola'));
      await update(tapUpdate(CHAT, 'nuevo paciente'));
      const before = inbound.length;
      await update(msgUpdate(CHAT, word));
      expect(lastTo(CHAT).text).toContain('¿Qué querés hacer?');
      expect(inbound.length).toBe(before);
    }
  });

  it('typing "/help" mid-walk hands the command to the brain, not the field', async () => {
    const CHAT = 10023;
    await update(msgUpdate(CHAT, 'hola'));
    await update(tapUpdate(CHAT, 'nuevo paciente'));        // (1/3) Cédula
    await update(msgUpdate(CHAT, '/help'));
    // It must reach the brain verbatim, NOT become the cédula in a submit.
    expect(inbound.some(b => b?.message === '/help')).toBe(true);
    expect(inbound.some(b => /nuevo-paciente \/help/.test(b?.message || ''))).toBe(false);
  });

  it('answers containing "||" are scrubbed before submit', async () => {
    const CHAT = 1003;
    await update(msgUpdate(CHAT, 'hola'));
    await update(tapUpdate(CHAT, 'nuevo paciente'));
    await update(msgUpdate(CHAT, '12345 || 99'));          // hostile cédula
    await update(msgUpdate(CHAT, 'Ana'));
    await update(msgUpdate(CHAT, 'Mora'));
    const submitted = inbound.map(b => b?.message).filter(m => /nuevo-paciente/.test(m || ''));
    expect(submitted.at(-1)).toBe('/nuevo-paciente 12345 99 || Ana || Mora');
  });

  it('a pending_action reply gets Sí/No buttons', async () => {
    const CHAT = 1004;
    await update(msgUpdate(CHAT, 'hola'));                 // welcome (swallowed)
    await update(msgUpdate(CHAT, 'confirmame'));
    const last = lastTo(CHAT);
    expect(last.text).toContain('¿Confirmas?');
    expect(labelsOf(last)).toEqual(expect.arrayContaining(['✅ Sí', '❌ No']));
  });

  it('an image sent mid new-patient walk is rejected, NOT routed to search', async () => {
    const CHAT = 1005;
    await update(msgUpdate(CHAT, 'hola'));
    await update(tapUpdate(CHAT, 'nuevo paciente'));        // (1/3) Cédula
    const before = inbound.length;
    const mark = sent.length;
    await update(photoUpdate(CHAT, 'soy una cédula'));
    const texts = textsTo(CHAT, mark);
    // The walk survives: no brain turn, no orphan attachment, field re-asked.
    expect(inbound.length).toBe(before);
    expect(texts.some(t => /todavía no puedo recibir imágenes/i.test(t))).toBe(true);
    expect(texts.some(t => t.includes('(1/3) Cédula'))).toBe(true);
    expect(texts.some(t => t.includes('Sin coincidencias'))).toBe(false);
    // And the walk still works afterwards.
    await update(msgUpdate(CHAT, '0900111222'));
    expect(lastTo(CHAT).text).toContain('(2/3) Nombres');
  });

  it('non-image media caption mid-walk is captured as the field answer', async () => {
    const CHAT = 1006;
    await update(msgUpdate(CHAT, 'hola'));
    await update(tapUpdate(CHAT, 'nuevo paciente'));        // (1/3) Cédula
    await update(videoCaptionUpdate(CHAT, '0911222333'));   // video, caption only
    // The caption becomes the cédula, never a search turn.
    expect(inbound.some(b => b?.message === '0911222333')).toBe(false);
    expect(lastTo(CHAT).text).toContain('(2/3) Nombres');
  });
});

describe('telegram gate-enabled (CEPI_CONFIRM_GATE=1) new-patient flow', () => {
  const CHAT = 1100;
  beforeAll(() => { gateOn = true; });
  afterAll(() => { gateOn = false; });

  it('completing the walk shows ¿Confirmas? + Sí/No — does NOT restart the walk', async () => {
    await update(msgUpdate(CHAT, 'hola'));
    await update(tapUpdate(CHAT, 'nuevo paciente'));
    await update(msgUpdate(CHAT, '0999000111'));
    await update(msgUpdate(CHAT, 'Gate'));
    const mark = sent.length;
    await update(msgUpdate(CHAT, 'On'));                    // 3rd field → submit
    const texts = textsTo(CHAT, mark);
    // The submit reached the brain exactly once...
    expect(inbound.filter(b => /nuevo-paciente 0999000111/.test(b?.message || '')).length).toBe(1);
    // ...and the stale patient_new echoed with the pending_action did NOT
    // restart the walk: we show ¿Confirmas? with Sí/No, not "(1/3) Cédula".
    const confirm = textsTo(CHAT, mark).find(t => t.includes('¿Confirmas?'));
    expect(confirm).toBeTruthy();
    expect(texts.some(t => t.includes('(1/3) Cédula'))).toBe(false);
    expect(labelsOf(lastTo(CHAT))).toEqual(expect.arrayContaining(['✅ Sí', '❌ No']));
  });
});

describe('telegram ficha walk callbacks', () => {
  const CHAT = 1200;

  it('renders the whole ficha section as context (not field-by-field intro stripping)', async () => {
    await update(msgUpdate(CHAT, 'hola'));
    await update(msgUpdate(CHAT, 'ficha'));
    // Fix #2: ficha keeps the whole-section render (title line present as context).
    const texts = textsTo(CHAT);
    expect(texts.some(t => t.includes('2.1 Antecedentes'))).toBe(true);
    expect(lastTo(CHAT).text).toContain('(1/2) ¿Fuma?');
  });

  it('walk option callbacks encode the field index (fw:<field>:<opt>)', async () => {
    const kb = lastTo(CHAT).reply_markup.inline_keyboard;
    const datas = kb.flat().map((b: any) => b.callback_data);
    expect(datas).toContain('fw:0:0');                     // field 0, option 0 (Sí)
    expect(datas).toContain('fw:0:1');                     // field 0, option 1 (No)
  });

  it('a stale fw tap for an already-answered field is ignored', async () => {
    // Answer field 0 (¿Fuma? → Sí) advancing to field 1.
    await update(tapUpdate(CHAT, 'fw:0:0'));
    expect(lastTo(CHAT).text).toContain('(2/2) Sexo');
    // Re-tapping the OLD field-0 keyboard must be a no-op (no advance/submit).
    const before = inbound.length;
    const mark = sent.length;
    await realFetch(`${base}/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tapUpdate(CHAT, 'fw:0:1')),
    });
    await new Promise(res => setTimeout(res, 60));
    expect(inbound.length).toBe(before);                   // no submit triggered
    expect(sent.length).toBe(mark);                        // nothing sent
  });

  it('a leftover fw tap with no active walk is a no-op (not routed to the brain)', async () => {
    const CHAT2 = 1201;
    await update(msgUpdate(CHAT2, 'hola'));                 // fresh chat, no walk
    const before = inbound.length;
    await realFetch(`${base}/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tapUpdate(CHAT2, 'fw:0:0')),
    });
    await new Promise(res => setTimeout(res, 60));
    expect(inbound.some(b => b?.message === 'fw:0:0')).toBe(false);
    expect(inbound.length).toBe(before);
  });
});
