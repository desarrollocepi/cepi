/**
 * Telegram: con un paciente activo, la inactividad PAUSA la consulta y pregunta;
 * no reinicia el chat. Antes, a los 5 minutos el bot tiraba la sesión y mostraba
 * el menú, y lo que el médico contestara después caía fuera de la ficha.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';

process.env.CEPI_BOT_URL = 'http://bot.test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.TELEGRAM_WEBHOOK_PORT = '0';
process.env.TELEGRAM_PUBLIC_URL = '';
process.env.CEPI_CANAL_GRACIA_MS = '0';

import { startTelegram } from '../src/telegram.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const CHAT = 8101;
const sent: Array<{ text: string; botones: string[] }> = [];
const turnos: any[] = [];
const FORM = { id: 'ficha_grp_g_3_2', title: '3.2 Tiempo de evolución', submit_mode: 'structured',
  fields: [{ key: 'evolucion', label: 'Tiempo de evolución' }], actions: [{ label: 'Omitir', send: 'omitir ficha' }] };

const realFetch = globalThis.fetch;
let server: ReturnType<typeof startTelegram>;
let base = '';
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));
async function update(payload: any): Promise<void> {
  const antes = sent.length;
  await realFetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  for (let i = 0; i < 60 && sent.length === antes; i++) await esperar(10);
  await esperar(40);
}
const msg = (text: string) => ({ message: { chat: { id: CHAT }, from: { id: CHAT }, text } });
const tap = (data: string) => ({ callback_query: { id: 'cb', data, from: { id: CHAT }, message: { chat: { id: CHAT } } } });

beforeAll(async () => {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (b: any, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('http://bot.test/')) return json({}, 404);
    if (u.includes('api.telegram.org')) {
      if (u.includes('/sendMessage')) { const b = JSON.parse(init.body); sent.push({ text: b.text, botones: (b.reply_markup?.inline_keyboard || []).flat().map((x: any) => x.text) }); }
      return json({ ok: true, result: {} });
    }
    if (u.endsWith('/api/auth/login')) return json({ token: jwt });
    if (u.includes('/api/auth/external/')) return json({ token: jwt, user: { role: 'medico', name: 'Ana' } });
    return realFetch(url, init);
  }) as typeof fetch;
  server = startTelegram(async ({ body }: any) => {
    turnos.push(body);
    const b = { ok: true, session_id: 'sess-tg', active_patient_id: 'p-1', status_header: '👤 Juan Pérez' };
    if (body.form_submission) return { status: 200, body: { ...b, text: 'Guardado.', quick_replies: [{ label: 'x', send: 'x' }] } };
    return { status: 200, body: { ...b, text: '3.2 Tiempo de evolución:', form: FORM } };
  });
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await update(msg('hola'));                 // menú de bienvenida
  await update(msg('ficha'));                // paciente activo y sección abierta
  process.env.CEPI_CANAL_INACTIVIDAD_MS = '150';
});
afterAll(() => { delete process.env.CEPI_CANAL_INACTIVIDAD_MS; globalThis.fetch = realFetch; server.close(); });

describe('telegram: la inactividad pausa, no reinicia', () => {
  it('al cumplirse el rato avisa y pregunta; ni menú ni sesión perdida', async () => {
    await update(msg('/ficha'));             // reabre la sección y rearma el reloj con el rato corto
    sent.length = 0;
    await esperar(320);
    expect(sent).toEqual([{ text: '⏸️ Pausé la consulta de Juan Pérez por inactividad.\n¿Sigues con Juan Pérez?', botones: ['Sí, continuar', 'Cambiar paciente'] }]);
  });

  it('lo que se escribe en pausa se retiene y se vuelve a preguntar', async () => {
    turnos.length = 0; sent.length = 0;
    await update(msg('2 semanas'));
    expect(turnos).toHaveLength(0);
    expect(sent.at(-1)!.text).toBe('¿Sigues con Juan Pérez?');
  });

  it('tocar un botón viejo en pausa vuelve a preguntar sin perder lo retenido', async () => {
    sent.length = 0;
    await update(tap('fs:0'));
    expect(turnos).toHaveLength(0);
    expect(sent.at(-1)!.text).toBe('¿Sigues con Juan Pérez?');
  });

  it('«Sí, continuar» procesa lo retenido como respuesta de la ficha, en la misma sesión', async () => {
    await update(tap('ps:si'));
    expect(turnos).toHaveLength(1);
    expect(turnos[0].session_id).toBe('sess-tg');
    expect(turnos[0].form_submission).toEqual({ form_id: 'ficha_grp_g_3_2', data: { evolucion: '2 semanas' } });
  });

  it('«Cambiar paciente» guarda lo contestado y muestra el menú', async () => {
    await update(msg('/ficha'));
    await esperar(320);                      // se pausa
    turnos.length = 0; sent.length = 0;
    await update(tap('ps:no'));
    expect(sent.at(-1)!.text).toContain('¿Qué querés hacer?');
    expect(turnos).toHaveLength(0);
  });
});
