/**
 * El estado del canal sobrevive a un reinicio del bot.
 *
 * Cada deploy reinicia el proceso. Antes eso le «cerraba la sesión» a quien
 * estuviera en medio de una consulta: perdía la sección que iba contestando y
 * el bot le preguntaba de nuevo con quién estaba.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cepi-estado-'));
process.env.CEPI_BOT_STATE_DIR = DIR;
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = '111';
process.env.WHATSAPP_APP_SECRET = 'app-secret';
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.WHATSAPP_WEBHOOK_PORT = '0';
process.env.CEPI_CANAL_GRACIA_MS = '0';

const FROM = '593990000001';
const ARCHIVO = path.join(DIR, 'whatsapp-0.json');
const FORM = { id: 'ficha_grp_g_1_1', title: '1.1 Datos de contacto', submit_mode: 'structured',
  fields: [{ key: 'direccion', label: 'Dirección' }, { key: 'telefono', label: 'Teléfono' }, { key: 'ciudad', label: 'Ciudad' }],
  actions: [{ label: 'Omitir', send: 'omitir ficha' }] };

// Lo que dejó escrito el proceso anterior: paciente activo y una sección a medias.
fs.writeFileSync(ARCHIVO, JSON.stringify({
  v: 1,
  phoneSessions: [[FROM, 'sess-previa']],
  pacienteActivo: [[FROM, 'Juan Pérez']],
  lastPatient: [[FROM, { id: 'p-9', name: 'Juan Pérez' }]],
  ultimoEntrante: [[FROM, Date.now() - 30_000]],
  formWalks: [[FROM, { form: FORM, idx: 1, answers: { direccion: 'Av. Uno' } }]],
  preguntas: [], enEspera: [], seriePregunta: 41,
  eco: [[FROM, { patientId: 'p-9', desde: Date.now() - 60_000, enviados: [] }]],
}));

import { startWhatsapp } from '../src/whatsapp.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const sent: string[] = [];
const turnos: any[] = [];
const realFetch = globalThis.fetch;
let server: ReturnType<typeof startWhatsapp>;
let base = '';

async function manda(text: string): Promise<void> {
  const antes = sent.length;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: FROM, id: 'wamid.in', type: 'text', text: { body: text } }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
  await realFetch(`${base}/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
  for (let i = 0; i < 100 && sent.length === antes; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 40));
}

beforeAll(async () => {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (status: number, body: any) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('graph.facebook.com')) {
      const b = JSON.parse(init.body);
      if (!b.typing_indicator) sent.push(b.type === 'interactive' ? b.interactive.body.text : b.text.body);
      return json(200, {});
    }
    if (u.endsWith('/api/auth/login')) return json(200, { token: jwt });
    if (u.includes('/api/auth/external/')) return json(200, { token: jwt, user: { role: 'medico', name: 'Ana' } });
    return realFetch(url, init);
  }) as typeof fetch;
  server = startWhatsapp(async ({ body }: any) => {
    turnos.push(body);
    return { status: 200, body: { ok: true, session_id: body.session_id, text: 'Guardado.', active_patient_id: 'p-9', status_header: '👤 Juan Pérez' } };
  });
  await new Promise<void>(r => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { globalThis.fetch = realFetch; server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

describe('WhatsApp: el estado sobrevive a un reinicio', () => {
  it('la respuesta va al campo que estaba abierto: ni «¿Sigues con…?» ni turno al cerebro', async () => {
    await manda('0999999999');
    expect(turnos).toHaveLength(0);
    expect(sent).toEqual(['(3/3) Ciudad']);
  });

  it('lo que cambia queda escrito para el reinicio siguiente', async () => {
    await new Promise(r => setTimeout(r, 400));
    const guardado = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    const [, walk] = guardado.formWalks.find(([k]: [string]) => k === FROM);
    expect(walk).toMatchObject({ idx: 2, answers: { direccion: 'Av. Uno', telefono: '0999999999' } });
    expect((fs.statSync(ARCHIVO).mode & 0o777).toString(8)).toBe('600');     // lleva datos clínicos
    expect(JSON.stringify(guardado)).not.toContain(jwt);                     // y ninguna credencial
  });

  it('la sección se envía completa, con lo contestado antes del reinicio, en la misma sesión', async () => {
    await manda('Quito');
    expect(turnos).toHaveLength(1);
    expect(turnos[0].session_id).toBe('sess-previa');
    expect(turnos[0].form_submission).toEqual({ form_id: 'ficha_grp_g_1_1',
      data: { direccion: 'Av. Uno', telefono: '0999999999', ciudad: 'Quito' } });
  });
});
