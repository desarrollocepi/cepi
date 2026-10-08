/**
 * WhatsApp tras un reinicio del bot. El paciente activo vive en memoria y un
 * deploy lo borra; el canal lo recupera de la última sesión de ese usuario por
 * WhatsApp y, antes de procesar nada, pregunta si sigue con el mismo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = '111';
process.env.WHATSAPP_APP_SECRET = 'app-secret';
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.WHATSAPP_WEBHOOK_PORT = '0';
process.env.CEPI_CANAL_GRACIA_MS = '0';
process.env.CEPI_BOT_URL = 'http://bot.test';

import { startWhatsapp } from '../src/whatsapp.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const sent: Array<{ text: string; botones: string[] }> = [];
const turnos: any[] = [];
let sesiones: any[] = [];

const realFetch = globalThis.fetch;
function mockFetch(): void {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (status: number, body: any) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u === 'http://bot.test/api/bot/sessions') return json(200, { ok: true, sessions: sesiones });
    if (u.includes('graph.facebook.com')) {
      const b = JSON.parse(init.body);
      if (b.typing_indicator) return json(200, {});
      if (b.type === 'interactive') sent.push({ text: b.interactive.body.text, botones: b.interactive.action.buttons.map((x: any) => x.reply.title) });
      else sent.push({ text: b.text.body, botones: [] });
      return json(200, {});
    }
    if (u.endsWith('/api/auth/login')) return json(200, { token: jwt });
    if (u.includes('/api/auth/external/')) return json(200, { token: jwt, user: { role: 'medico', name: 'Ana' } });
    return realFetch(url, init);
  }) as typeof fetch;
}

let server: ReturnType<typeof startWhatsapp>;
let base = '';
async function manda(from: string, text: string): Promise<void> {
  const antes = sent.length;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.in', type: 'text', text: { body: text } }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
  await realFetch(`${base}/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
  for (let i = 0; i < 100 && sent.length === antes; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 30));
}

beforeAll(async () => {
  mockFetch();
  server = startWhatsapp(async ({ body }: any) => {
    turnos.push(body);
    return { status: 200, body: { ok: true, session_id: body.session_id || 'sess-nueva', text: 'Anotado.', active_patient_id: 'p-9', status_header: '👤 Juan Pérez' } };
  });
  await new Promise<void>(r => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { globalThis.fetch = realFetch; server.close(); });

describe('WhatsApp tras un reinicio', () => {
  it('con una sesión anterior por WhatsApp con paciente, pregunta antes de procesar', async () => {
    sesiones = [
      { id: 'sess-web', canal: '', estado: 'abierta', active_patient_id: 'p-1', patient_name: 'De la web', updated_at: new Date().toISOString() },
      { id: 'sess-vieja', canal: 'whatsapp', estado: 'abierta', active_patient_id: 'p-9', patient_name: 'Juan Pérez', updated_at: new Date().toISOString() },
    ];
    await manda('593990000001', 'tiene fiebre');
    expect(turnos).toHaveLength(0);
    expect(sent.at(-1)).toEqual({ text: '¿Sigues con *Juan Pérez*?', botones: ['Sí, continuar', 'Cambiar paciente'] });
  });

  it('«sí» retoma ESA sesión y procesa el mensaje retenido', async () => {
    await manda('593990000001', 'sí');
    expect(turnos.map(t => [t.message, t.session_id, t.canal])).toEqual([['tiene fiebre', 'sess-vieja', 'whatsapp']]);
    expect(sent.at(-1)!.text).toBe('👤 Juan Pérez\nAnotado.');
  });

  it('si la última sesión del canal ya no tiene paciente, no pregunta', async () => {
    sesiones = [{ id: 's', canal: 'whatsapp', estado: 'abierta', active_patient_id: null, updated_at: new Date().toISOString() }];
    turnos.length = 0;
    await manda('593990000002', 'hola');
    expect(turnos.map(t => [t.message, t.session_id])).toEqual([['hola', undefined]]);
  });

  it('una sesión de hace más de un día no se retoma', async () => {
    sesiones = [{ id: 's', canal: 'whatsapp', estado: 'abierta', active_patient_id: 'p-9', patient_name: 'Juan Pérez',
      updated_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }];
    turnos.length = 0;
    await manda('593990000003', 'hola');
    expect(turnos.map(t => t.message)).toEqual(['hola']);
  });
});
