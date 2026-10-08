/**
 * Telegram: una identidad pendiente de aprobación no entra al bot.
 *
 * Hallado probando en producción: quien escribía por primera vez quedaba dado
 * de alta como `pendiente` y aun así veía el menú; «Nuevo paciente» no
 * contestaba nada (el turno fallaba en silencio) y el texto libre iba al LLM.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.TELEGRAM_BOT_AUTOALTA = '1';
process.env.TELEGRAM_WEBHOOK_PORT = '0';
process.env.TELEGRAM_PUBLIC_URL = '';
process.env.CEPI_CANAL_GRACIA_MS = '0';

import { startTelegram, avisarRegistroListoTelegram } from '../src/telegram.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const sent: Array<{ chat_id: number; text: string }> = [];
const turnos: any[] = [];
/** id de Telegram → rol que le devuelve el ERP. Sin entrada: nace pendiente. */
const roles: Record<string, string> = {};
const altas = new Set<string>();
let cerebroFalla = false;

const realFetch = globalThis.fetch;
let server: ReturnType<typeof startTelegram>;
let base = '';
const msg = (id: number, text: string) => ({ message: { chat: { id }, from: { id, first_name: 'Ana' }, text } });
async function update(payload: any): Promise<void> {
  const antes = sent.length;
  await realFetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  for (let i = 0; i < 40 && sent.length === antes; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 30));
}

beforeAll(async () => {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (b: any) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('api.telegram.org')) { if (u.includes('/sendMessage')) sent.push(JSON.parse(init.body)); return json({ ok: true, result: {} }); }
    if (u.endsWith('/api/auth/login')) return json({ token: jwt });
    if (u.includes('/api/auth/external/')) {
      const b = JSON.parse(init.body);
      const creada = !altas.has(b.external_id); altas.add(b.external_id);
      return json({ token: jwt, creada, user: { role: roles[b.external_id] || 'pendiente', name: 'Ana Pérez' } });
    }
    return realFetch(url, init);
  }) as typeof fetch;
  server = startTelegram(async ({ body }: any) => {
    turnos.push(body);
    if (cerebroFalla) return { status: 500, body: { ok: false, error: 'boom' } };
    return { status: 200, body: { ok: true, session_id: 's1', text: 'hola doctora' } };
  });
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { globalThis.fetch = realFetch; server.close(); });
beforeEach(() => { sent.length = 0; turnos.length = 0; cerebroFalla = false; });

describe('telegram: identidad pendiente', () => {
  it('la primera vez recibe UN aviso de registro; ni menú ni cerebro', async () => {
    await update(msg(501, 'hola'));
    expect(sent.map(s => s.text)).toEqual(['👋 Hola, Ana. Recibimos tu mensaje.\n\nEstamos procesando tu registro en CEPI Telemedicina; te contestaremos cuando esté listo.']);
    expect(turnos).toHaveLength(0);
  });

  it('después, silencio: cada respuesta a un desconocido es un mensaje de más', async () => {
    await update(msg(501, 'hola??'));
    await update(msg(501, 'nuevo paciente'));
    expect(sent).toEqual([]);
    expect(turnos).toHaveLength(0);
  });

  it('al aprobarla, el aviso de «registro listo» sale una sola vez y solo si de verdad tiene acceso', async () => {
    expect(await avisarRegistroListoTelegram(501)).toBe('omitido');       // sigue pendiente
    roles['501'] = 'medico_primario';
    expect(await avisarRegistroListoTelegram(501)).toBe('enviado');
    expect(sent.map(s => [s.chat_id, s.text])).toEqual([[501, '✅ Hola, Ana. Tu registro en CEPI Telemedicina está listo: ya puedes escribir por este chat.']]);
    expect(await avisarRegistroListoTelegram(501)).toBe('omitido');
  });

  it('ya aprobada, entra: primer contacto muestra el menú', async () => {
    await update(msg(501, 'hola'));
    expect(sent.at(-1)!.text).toContain('¿Qué querés hacer?');
  });
});

describe('telegram: un turno que falla se dice', () => {
  it('no deja el botón mudo', async () => {
    roles['502'] = 'medico_primario';
    await update(msg(502, 'hola'));            // menú
    sent.length = 0; cerebroFalla = true;
    await update(msg(502, 'nuevo paciente'));
    expect(sent.map(s => s.text)).toEqual(['No pude procesar tu mensaje. Prueba de nuevo en un rato.']);
  });
});
