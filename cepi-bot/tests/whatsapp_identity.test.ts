/**
 * WhatsApp adapter e2e tests (no network): boots the real webhook listener via
 * startWhatsapp() on a random port, mocks `fetch` so Graph API sends are
 * captured and TodoERP auth endpoints answer locally, and posts signed webhook
 * payloads the way Meta does.
 *
 * Regression under test: the number is public, and the adapter used to run
 * every inbound turn as the admin service account. Now a phone must resolve to
 * a TodoERP user (users.data.whatsapp_phone) and the turn runs AS that user.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// ── Env must be set before importing the adapter ───────────────────────────
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = '111';
process.env.WHATSAPP_APP_SECRET = 'app-secret';
process.env.WHATSAPP_BOT_EMAIL = 'svc@test.local';
process.env.WHATSAPP_BOT_PASSWORD = 'secret';
process.env.WHATSAPP_WEBHOOK_PORT = '0';            // random free port

import { startWhatsapp, phoneCandidates } from '../src/whatsapp.js';

/** A syntactically valid JWT whose payload carries a far-future exp. */
const jwtFor = (who: string) => 'h.' +
  Buffer.from(JSON.stringify({ sub: who, exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') +
  '.s';

/** Phone (as stored on the user) → user the resolve endpoint answers for. */
const linked: Record<string, string> = { '+593990000001': 'medico' };

const sent: Array<{ to: string; text: string }> = [];
const turns: Array<{ auth: string; message: string }> = [];
let brainReply: { status: number; body: any } = { status: 200, body: { text: 'hola doctor' } };

const realFetch = globalThis.fetch;
function mockFetch(): void {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (status: number, body: any) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('graph.facebook.com')) {
      const b = JSON.parse(init.body);
      sent.push({ to: b.to, text: b.text.body });
      return json(200, { messages: [{ id: 'wamid.x' }] });
    }
    if (u.endsWith('/api/auth/login')) return json(200, { token: jwtFor('svc') });
    if (u.endsWith('/api/auth/external/resolve')) {
      const b = JSON.parse(init.body);
      const who = b.platform === 'whatsapp' ? linked[b.external_id] : undefined;
      return who ? json(200, { token: jwtFor(who) }) : json(404, { error: 'not linked' });
    }
    return realFetch(url, init);
  }) as typeof fetch;
}

let server: ReturnType<typeof startWhatsapp>;
let base = '';

beforeAll(async () => {
  mockFetch();
  server = startWhatsapp(async ({ headers, body }) => {
    turns.push({ auth: headers?.authorization || '', message: body.message });
    return brainReply;
  });
  await new Promise<void>(r => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  server.close();
});

beforeEach(() => {
  sent.length = 0;
  turns.length = 0;
  brainReply = { status: 200, body: { text: 'hola doctor' } };
});

/** POST a one-message webhook payload signed like Meta, then let it process. */
async function inbound(from: string, text: string): Promise<void> {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { messages: [{ from, type: 'text', text: { body: text } }] } }] }],
  });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
  const r = await realFetch(`${base}/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: raw,
  });
  expect(r.status).toBe(200);
  // The handler acks first and processes after; wait for the outbound send.
  for (let i = 0; i < 50 && sent.length === 0; i++) await new Promise(r => setTimeout(r, 10));
}

describe('WhatsApp identity gate', () => {
  it('runs the turn AS the user linked to the phone, not as the service account', async () => {
    await inbound('593990000001', 'hola');
    expect(turns).toHaveLength(1);
    expect(turns[0].auth).toBe(`Bearer ${jwtFor('medico')}`);
    expect(sent).toEqual([{ to: '593990000001', text: 'hola doctor' }]);
  });

  it('refuses a phone linked to nobody, without reaching the brain', async () => {
    await inbound('593990000099', 'hola');
    expect(turns).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('no está registrado');
    expect(sent[0].text).toContain('+593990000099');
  });

  it('says the turn failed instead of answering "…"', async () => {
    brainReply = { status: 500, body: { ok: false, error: 'boom' } };
    await inbound('593990000001', 'hola');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('No pude procesar tu mensaje');
  });
});

describe('phoneCandidates', () => {
  it('tries the bare digits and the "+" form', () => {
    expect(phoneCandidates('593998994582')).toEqual(['593998994582', '+593998994582']);
    expect(phoneCandidates('')).toEqual([]);
  });
});
