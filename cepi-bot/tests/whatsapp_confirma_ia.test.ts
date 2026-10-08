/**
 * Lo que interpreta la IA no se guarda sin confirmación.
 *
 * Regresión de producción: «el primero de enero del dos mil» en la fecha de
 * nacimiento → el modelo contestó 2026-01-01 y se guardó sin preguntar.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// El cerebro propio (sesiones, estado de la ficha) no existe en este test: que
// las consultas a él fallen al instante en vez de salir a la red.
process.env.CEPI_BOT_URL = 'http://bot.test';
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = '111';
process.env.WHATSAPP_APP_SECRET = 'app-secret';
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.WHATSAPP_WEBHOOK_PORT = '0';
process.env.CEPI_CANAL_GRACIA_MS = '0';

/** Lo que el modelo «entiende» en cada test. */
let dichoPorIA = '2026-01-01';
vi.mock('../src/llm.js', async (orig) => ({
  ...(await orig() as any),
  getLLMAdapter: async () => ({ name: 'falso', step: async () => ({ kind: 'message', text: dichoPorIA }) }),
}));

import { startWhatsapp } from '../src/whatsapp.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const FROM = '593990000001';
const sent: Array<{ text: string; botones: Array<{ id: string; title: string }> }> = [];
const turnos: any[] = [];

const realFetch = globalThis.fetch;
function mockFetch(): void {
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url).startsWith('http://bot.test/') && !String(url).includes('/api/bot/sessions')) return new Response('{}', { status: 404 });
    const u = String(url);
    const json = (status: number, body: any) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('graph.facebook.com')) {
      const b = JSON.parse(init.body);
      if (b.typing_indicator) return json(200, {});
      if (b.type === 'interactive') sent.push({ text: b.interactive.body.text, botones: (b.interactive.action.buttons || []).map((x: any) => x.reply) });
      else sent.push({ text: b.text.body, botones: [] });
      return json(200, {});
    }
    if (u.endsWith('/api/auth/login')) return json(200, { token: jwt });
    if (u.includes('/api/auth/external/')) return json(200, { token: jwt, user: { role: 'medico', name: 'Ana' } });
    if (u.includes('/api/bot/sessions')) return json(200, { ok: true, sessions: [] });
    return realFetch(url, init);
  }) as typeof fetch;
}

const FORM = { id: 'ficha_grp_g_1_2', title: '1.2 Fecha de nacimiento', submit_mode: 'structured',
  fields: [{ key: 'fecha_nac', label: 'Fecha de nacimiento', type: 'date' }], actions: [{ label: 'Omitir', send: 'omitir ficha' }] };

let server: ReturnType<typeof startWhatsapp>;
let base = '';
async function manda(m: { text?: string; boton?: string }): Promise<void> {
  const antes = sent.length;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [m.boton
    ? { from: FROM, id: 'wamid.in', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: m.boton, title: 'x' } } }
    : { from: FROM, id: 'wamid.in', type: 'text', text: { body: m.text } }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
  await realFetch(`${base}/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
  let ultimo = -1;
  for (let i = 0; i < 120; i++) { if (sent.length > antes && sent.length === ultimo) break; ultimo = sent.length; await new Promise(r => setTimeout(r, 15)); }
}
const boton = (titulo: string) => sent.at(-1)!.botones.find(b => b.title === titulo)!.id;

beforeAll(async () => {
  mockFetch();
  server = startWhatsapp(async ({ body }: any) => {
    turnos.push(body);
    const baseR = { ok: true, session_id: 'sess-wa', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba' };
    if (body.form_submission) return { status: 200, body: { ...baseR, text: 'Guardado.' } };
    return { status: 200, body: { ...baseR, text: '1.2 Fecha de nacimiento:', form: FORM } };
  });
  await new Promise<void>(r => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { globalThis.fetch = realFetch; server.close(); });
beforeEach(async () => { await manda({ text: 'cancelar' }); await manda({ text: 'ficha' }); turnos.length = 0; });

describe('WhatsApp: lo que interpreta la IA se confirma antes de guardar', () => {
  it('pregunta «Entendí …. ¿Es correcto?» y no manda nada al cerebro', async () => {
    dichoPorIA = '2026-01-01';
    await manda({ text: 'el primero de enero del dos mil' });
    expect(turnos).toHaveLength(0);
    expect(sent.at(-1)!.text).toBe('Entendí *1 de enero de 2026*. ¿Es correcto?');
    expect(sent.at(-1)!.botones.map(b => b.title)).toEqual(['Sí', 'No']);
  });

  it('«No» descarta la interpretación y vuelve a preguntar el campo', async () => {
    await manda({ text: 'el primero de enero del dos mil' });
    await manda({ boton: boton('No') });
    expect(turnos).toHaveLength(0);
    expect(sent.at(-1)!.text).toBe('(1/1) Fecha de nacimiento');
    // Y la fecha escrita con cifras entra por el validador determinista, sin confirmación.
    await manda({ text: '01/01/2000' });
    expect(turnos[0].form_submission.data).toEqual({ fecha_nac: '2000-01-01' });
  });

  it('«Sí» guarda el valor confirmado', async () => {
    dichoPorIA = '2000-01-01';
    await manda({ text: 'el primero de enero del dos mil' });
    await manda({ text: 'si' });
    expect(turnos[0].form_submission.data).toEqual({ fecha_nac: '2000-01-01' });
  });
});
