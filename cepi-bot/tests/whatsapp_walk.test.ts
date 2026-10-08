/**
 * WhatsApp: opciones, alta de paciente campo por campo y registro crudo.
 *
 * Regresión: por WhatsApp el alta de paciente no existía. «Nuevo» terminaba en
 * el LLM y el formulario, cuando salía, era una lista de texto cuya respuesta
 * se tomaba como búsqueda. Acá corre el adaptador real contra un cerebro
 * guionado con el mismo contrato que flowV1.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

import { startWhatsapp } from '../src/whatsapp.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const FROM = '593990000001';

interface Salida { text: string; botones: Array<{ id: string; title: string }>; }
const sent: Salida[] = [];
/** Cuerpos que recibió el cerebro. */
const turnos: any[] = [];
/** Si está, Meta rechaza los mensajes interactivos (para probar la caída a texto). */
let rechazarBotones = false;
/** Los últimos botones que vio la persona: sobreviven al beforeEach, como en su pantalla. */
let vistos: Array<{ id: string; title: string }> = [];

const realFetch = globalThis.fetch;
function mockFetch(): void {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (status: number, body: any) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('graph.facebook.com')) {
      const b = JSON.parse(init.body);
      if (b.typing_indicator) return json(200, { success: true });
      if (b.type === 'interactive') {
        if (rechazarBotones) return json(400, { error: { message: 'no' } });
        vistos = b.interactive.action.buttons.map((x: any) => x.reply);
        sent.push({ text: b.interactive.body.text, botones: vistos });
      } else sent.push({ text: b.text.body, botones: [] });
      return json(200, { messages: [{ id: 'wamid.x' }] });
    }
    if (u.endsWith('/api/auth/login')) return json(200, { token: jwt });
    if (u.includes('/api/auth/external/')) return json(200, { token: jwt, user: { role: 'medico', name: 'Ana' } });
    return realFetch(url, init);
  }) as typeof fetch;
}

const PATIENT_NEW_FORM = {
  id: 'patient_new', title: 'Nuevo paciente',
  fields: [
    { key: 'cedula', label: 'Cédula', placeholder: 'Ej: 12345678', required: true },
    { key: 'nombre', label: 'Nombres', required: true },
    { key: 'apellidos', label: 'Apellidos', required: true },
  ],
  submit_send: '/nuevo-paciente {cedula} || {nombre} || {apellidos}',
};
const FICHA_FORM = {
  id: 'ficha_grp_g_2_1', title: '2.1 Antecedentes', submit_mode: 'structured',
  fields: [
    { key: 'fuma', label: '¿Fuma?', type: 'radio', options: [{ label: 'Sí', value: true }, { label: 'No', value: false }] },
    { key: 'fototipo', label: 'Fototipo', type: 'radio', options: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
    { key: 'foto', label: 'Foto de la lesión', type: 'image_upload' },
    { key: 'obs', label: 'Observaciones' },
  ],
  actions: [{ label: 'Omitir', send: 'omitir ficha' }],
};
const ATAJOS = [{ label: '➕ Nuevo paciente', send: 'nuevo paciente' }, { label: '🔍 Buscar paciente', send: 'paciente' }];

async function cerebro({ body }: { body: any }) {
  turnos.push(body);
  const base = { ok: true, session_id: 'sess-wa', form: null, quick_replies: [], pending_action: null };
  const msg = String(body?.message || '');
  if (!msg && !body?.form_submission) return { status: 200, body: { ok: true, session_id: body.session_id, solo_registro: true } };
  if (body?.form_submission) return { status: 200, body: { ...base, text: 'Antecedentes guardados.', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba' } };
  if (/^nuevo paciente$/i.test(msg)) return { status: 200, body: { ...base, text: 'Completá los datos del nuevo paciente.', form: PATIENT_NEW_FORM, status_header: '📋 Creando paciente' } };
  if (/^\/nuevo-paciente /.test(msg)) return { status: 200, body: { ...base, text: 'Listo, quedó registrado. Empecemos la ficha:', form: FICHA_FORM, active_patient_id: 'p-1', status_header: '👤 Paciente Prueba — ficha §2.1 Antecedentes' } };
  if (/^omitir ficha$/i.test(msg)) return { status: 200, body: { ...base, text: 'Sección omitida.', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba' } };
  return { status: 200, body: { ...base, text: 'Escribe «nuevo paciente» para crear uno.', quick_replies: ATAJOS } };
}

let server: ReturnType<typeof startWhatsapp>;
let base = '';

/** Manda un mensaje firmado como Meta y espera a que el bot deje de escribir. */
async function manda(m: { text?: string; boton?: string }): Promise<void> {
  const antes = sent.length;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [m.boton
    ? { from: FROM, id: 'wamid.in', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: m.boton, title: 'x' } } }
    : { from: FROM, id: 'wamid.in', type: 'text', text: { body: m.text } }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
  const r = await realFetch(`${base}/whatsapp`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
  expect(r.status).toBe(200);
  let ultimo = -1;
  for (let i = 0; i < 150; i++) {
    if (sent.length > antes && sent.length === ultimo) break;
    ultimo = sent.length;
    await new Promise(res => setTimeout(res, 15));
  }
}
const ultimo = () => sent.at(-1)!;
const boton = (titulo: string) => vistos.find(b => b.title === titulo)!.id;

beforeAll(async () => {
  mockFetch();
  server = startWhatsapp(cerebro as any);
  await new Promise<void>(r => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { globalThis.fetch = realFetch; server.close(); });
beforeEach(() => { sent.length = 0; turnos.length = 0; rechazarBotones = false; });

describe('WhatsApp: alta de paciente campo por campo', () => {
  it('las opciones del cerebro salen como botones', async () => {
    await manda({ text: 'Que puedo hacer' });
    expect(ultimo().botones.map(b => b.title)).toEqual(['➕ Nuevo paciente', '🔍 Buscar paciente']);
  });

  it('el botón «Nuevo paciente» abre el recorrido en la primera pregunta', async () => {
    await manda({ boton: boton('➕ Nuevo paciente') });
    expect(turnos.at(-1).message).toBe('nuevo paciente');
    expect(sent.map(s => s.text)).toEqual([
      '📋 Creando paciente\nCompletá los datos del nuevo paciente.', '(1/3) Cédula (Ej: 12345678)']);
  });

  it('la cédula la toma el recorrido, NO va al cerebro como búsqueda', async () => {
    await manda({ text: '1234567895' });
    expect(turnos).toHaveLength(0);
    expect(ultimo().text).toBe('(2/3) Nombres');
  });

  it('al terminar envía /nuevo-paciente y sigue con la ficha', async () => {
    await manda({ text: 'Paciente Prueba' });
    await manda({ text: 'Lunes' });
    expect(turnos.map(t => t.message)).toEqual(['/nuevo-paciente 1234567895 || Paciente Prueba || Lunes']);
    expect(ultimo().text).toBe('(1/4) ¿Fuma?');
    expect(ultimo().botones.map(b => b.title)).toEqual(['Sí', 'No', 'Omitir']);
  });
});

describe('WhatsApp: recorrido de una sección de la ficha', () => {
  it('una pregunta cerrada contestada con otra cosa se vuelve a preguntar', async () => {
    await manda({ text: 'a veces' });
    expect(sent.map(s => s.text)).toEqual(['Elige una de las opciones.', '(1/4) ¿Fuma?']);
    expect(turnos).toHaveLength(0);
  });

  it('«no» escrito vale como el botón; más de 3 opciones salen numeradas', async () => {
    await manda({ text: 'no' });
    expect(ultimo().botones).toEqual([]);
    expect(ultimo().text).toBe('(2/4) Fototipo\n\n1. I\n2. II\n3. III\n4. IV\n5. V\n6. VI\n\n_Omitir: escribe «omitir ficha»_');
  });

  it('el número elige la opción, el campo de imagen se salta y se dice', async () => {
    await manda({ text: '3' });
    expect(sent.map(s => s.text)).toEqual([
      '«Foto de la lesión»: las imágenes todavía no se reciben por WhatsApp. Súbelas desde la web o la app.',
      '(4/4) Observaciones']);
  });

  it('al terminar envía la sección estructurada con los valores tipados', async () => {
    await manda({ text: 'sin novedades' });
    expect(turnos).toHaveLength(1);
    expect(turnos[0].form_submission).toEqual({
      form_id: 'ficha_grp_g_2_1', data: { fuma: false, fototipo: 'III', obs: 'sin novedades' } });
    expect(ultimo().text).toBe('👤 Paciente Prueba\nAntecedentes guardados.');
  });

  it('un botón de una pregunta anterior ya no vale', async () => {
    await manda({ boton: 'op:1:0' });
    expect(ultimo().text).toBe('Esa opción ya no está vigente.');
    expect(turnos).toHaveLength(0);
  });

  it('«menú» muestra el menú con el paciente anterior', async () => {
    await manda({ text: 'menú' });
    expect(ultimo().text).toBe('Hola 👋 ¿Qué quieres hacer?\nPaciente anterior: Paciente Prueba');
    expect(ultimo().botones.map(b => b.title)).toEqual(['Nuevo paciente', 'Buscar paciente', 'Paciente anterior']);
    expect(turnos).toHaveLength(0);
  });

  it('si Meta rechaza los botones, las opciones salen numeradas y el número funciona', async () => {
    rechazarBotones = true;
    await manda({ text: 'menú' });
    expect(ultimo().text).toContain('1. Nuevo paciente\n2. Buscar paciente\n3. Paciente anterior');
    await manda({ text: '1' });
    expect(turnos.at(-1).message).toBe('nuevo paciente');
  });
});

describe('WhatsApp: registro crudo', () => {
  it('cada turno lleva lo que pasó en el canal desde el anterior, entrada y salida', async () => {
    await manda({ text: 'cancelar' });               // sale del recorrido abierto arriba
    await manda({ text: 'hola' });
    const crudo: any[] = turnos.at(-1).canal_raw;
    expect(crudo.every(e => e.canal === 'whatsapp' && typeof e.ts === 'string')).toBe(true);
    // El mensaje entrante va tal cual lo entregó Meta.
    const entrada = crudo.filter(e => e.dir === 'in').at(-1);
    expect(entrada.texto).toBe('hola');
    expect(entrada.crudo).toMatchObject({ from: FROM, type: 'text', text: { body: 'hola' } });
    // Y lo que el bot escribió y nunca pasó por el cerebro (el menú) también.
    expect(crudo.some(e => e.dir === 'out' && /¿Qué quieres hacer\?/.test(e.texto))).toBe(true);
    expect(crudo.some(e => e.dir === 'in' && e.texto === 'cancelar')).toBe(true);
  });
});
