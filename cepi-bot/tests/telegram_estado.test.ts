/**
 * Telegram: el estado del canal sobrevive a un reinicio del bot (un deploy).
 * Antes, tras cada deploy el chat volvía al menú y había que buscar al paciente
 * otra vez; los botones ya enviados dejaban de servir.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cepi-estado-tg-'));
process.env.CEPI_BOT_STATE_DIR = DIR;
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.TELEGRAM_WEBHOOK_PORT = '0';
process.env.TELEGRAM_PUBLIC_URL = '';
process.env.CEPI_CANAL_GRACIA_MS = '0';

const CHAT = 9001;
const ARCHIVO = path.join(DIR, 'telegram-0.json');
const FORM = { id: 'ficha_grp_g_1_1', title: '1.1 Datos de contacto', submit_mode: 'structured',
  fields: [{ key: 'direccion', label: 'Dirección' }, { key: 'telefono', label: 'Teléfono' }],
  actions: [{ label: 'Omitir', send: 'omitir ficha' }] };

fs.writeFileSync(ARCHIVO, JSON.stringify({
  v: 1,
  chatSessions: [[CHAT, 'sess-previa']], lastSeen: [[CHAT, Date.now() - 20_000]],
  lastPatient: [[CHAT, { id: 'p-9', name: 'Juan Pérez' }]], pacienteActivo: [[CHAT, 'Juan Pérez']],
  formWalks: [[CHAT, { form: FORM, idx: 1, answers: { direccion: 'Av. Uno' } }]],
  chatFrom: [[CHAT, CHAT]], callbackSends: [['q7', 'nota desde un botón viejo']], cbCounter: 8,
  eco: [[CHAT, { patientId: 'p-9', desde: Date.now() - 60_000, enviados: [] }]],
}));

import { startTelegram } from '../src/telegram.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const sent: string[] = [];
const turnos: any[] = [];
const realFetch = globalThis.fetch;
let server: ReturnType<typeof startTelegram>;
let base = '';
async function update(payload: any): Promise<void> {
  const antes = sent.length;
  await realFetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  for (let i = 0; i < 60 && sent.length === antes; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 40));
}

beforeAll(async () => {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (b: any) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('api.telegram.org')) { if (u.includes('/sendMessage')) sent.push(JSON.parse(init.body).text); return json({ ok: true, result: {} }); }
    if (u.endsWith('/api/auth/login')) return json({ token: jwt });
    if (u.includes('/api/auth/external/')) return json({ token: jwt, user: { role: 'medico', name: 'Ana' } });
    return realFetch(url, init);
  }) as typeof fetch;
  server = startTelegram(async ({ body }: any) => {
    turnos.push(body);
    return { status: 200, body: { ok: true, session_id: body.session_id, text: 'Guardado.', active_patient_id: 'p-9', status_header: '👤 Juan Pérez', quick_replies: [{ label: 'x', send: 'x' }] } };
  });
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { globalThis.fetch = realFetch; server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

describe('telegram: el estado sobrevive a un reinicio', () => {
  it('la respuesta completa la sección que estaba a medias: sin menú, en la misma sesión', async () => {
    await update({ message: { chat: { id: CHAT }, from: { id: CHAT }, text: '0999999999' } });
    expect(sent.some(t => /¿Qué querés hacer\?/.test(t))).toBe(false);
    expect(turnos).toHaveLength(1);
    expect(turnos[0].session_id).toBe('sess-previa');
    expect(turnos[0].form_submission).toEqual({ form_id: 'ficha_grp_g_1_1', data: { direccion: 'Av. Uno', telefono: '0999999999' } });
  });

  it('un botón enviado antes del reinicio sigue sirviendo', async () => {
    turnos.length = 0;
    await update({ callback_query: { id: 'cb', data: 'q7', from: { id: CHAT }, message: { chat: { id: CHAT } } } });
    expect(turnos.map(t => t.message)).toEqual(['nota desde un botón viejo']);
  });

  it('lo que cambia queda escrito, sin credenciales y con permisos 600', async () => {
    await new Promise(r => setTimeout(r, 400));
    const texto = fs.readFileSync(ARCHIVO, 'utf8');
    expect(JSON.parse(texto).formWalks).toEqual([]);                 // la sección ya se envió
    expect(texto).not.toContain(jwt);
    expect((fs.statSync(ARCHIVO).mode & 0o777).toString(8)).toBe('600');
  });
});
