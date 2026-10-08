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
// Only the Telegram service account is set, as in prod: WhatsApp must reuse it.
delete process.env.WHATSAPP_BOT_EMAIL;
delete process.env.WHATSAPP_BOT_PASSWORD;
process.env.TELEGRAM_BOT_EMAIL = 'svc@test.local';
process.env.TELEGRAM_BOT_PASSWORD = 'secret';
// La organización es obligatoria: sin ella el turno correría sin org activa,
// o sea sin estar limitado a nadie (PAPER §27.4).
process.env.TELEGRAM_BOT_ORG = 'cepi';
process.env.WHATSAPP_WEBHOOK_PORT = '0';            // random free port
// Ventana de gracia corta: alcanza para tocar «Cancelar» y no frena la suite.
process.env.CEPI_CANAL_GRACIA_MS = '150';

import { startWhatsapp, phoneCandidates } from '../src/whatsapp.js';

/** A syntactically valid JWT whose payload carries a far-future exp. */
const jwtFor = (who: string) => 'h.' +
  Buffer.from(JSON.stringify({ sub: who, exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') +
  '.s';

/** Phone (as stored on the user) → user the resolve endpoint answers for. */
const linked: Record<string, string> = { '+593990000001': 'medico' };

const sent: Array<{ to: string; text: string }> = [];
const turns: Array<{ auth: string; message: string }> = [];
/** Ids de mensaje para los que el bot encendió el «escribiendo…». */
const typing: string[] = [];
/** Ids de los botones «Cancelar» que salieron con el aviso. */
const botones: string[] = [];
/** Lo que el bot le mandó al endpoint de identidad, para poder afirmar sobre org y ruta. */
const resoluciones: Array<{ ruta: string; body: any }> = [];
/** Números dados de alta por el mock de `/ensure`. */
const altas = new Set<string>();
let brainReply: { status: number; body: any } = { status: 200, body: { text: 'hola doctor' } };

const realFetch = globalThis.fetch;
function mockFetch(): void {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (status: number, body: any) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('graph.facebook.com')) {
      const b = JSON.parse(init.body);
      // El «escribiendo…» va por el mismo endpoint y no es un mensaje.
      if (b.typing_indicator) { typing.push(b.message_id); return json(200, { success: true }); }
      // El aviso con botón es `interactive`; su id de botón queda aparte.
      if (b.type === 'interactive') {
        botones.push(b.interactive.action.buttons[0].reply.id);
        sent.push({ to: b.to, text: b.interactive.body.text });
      } else sent.push({ to: b.to, text: b.text.body });
      return json(200, { messages: [{ id: 'wamid.x' }] });
    }
    if (u.endsWith('/api/auth/login')) return json(200, { token: jwtFor('svc') });
    if (u.includes('/api/auth/external/')) {
      const b = JSON.parse(init.body);
      resoluciones.push({ ruta: u.split('/api/auth/external/')[1], body: b });
      const who = b.platform === 'whatsapp' ? linked[b.external_id] : undefined;
      if (who) return json(200, { token: jwtFor(who), user: { role: 'medico', name: 'Ana María Pérez' } });
      // `ensure` da de alta al desconocido; `resolve` lo rechaza.
      // Ya dado de alta y todavía sin aprobar: `resolve` lo devuelve pendiente.
      if (u.endsWith('/resolve') && altas.has(b.external_id)) {
        return json(200, { token: jwtFor(`nuevo:${b.external_id}`), user: { role: 'pendiente' } });
      }
      // La primera vez nace en rol `pendiente`; las siguientes ya existe.
      if (u.endsWith('/ensure')) {
        const creada = !altas.has(b.external_id);
        altas.add(b.external_id);
        return json(200, { creada, token: jwtFor(`nuevo:${b.external_id}`), user: { role: 'pendiente' } });
      }
      return json(404, { error: 'not linked' });
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
async function inbound(from: string, text: string, perfil?: string, esperados = 1, boton?: string): Promise<void> {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      messages: [boton
        ? { from, id: `wamid.${from}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: boton, title: 'Cancelar' } } }
        : { from, id: `wamid.${from}`, type: 'text', text: { body: text } }],
      ...(perfil ? { contacts: [{ wa_id: from, profile: { name: perfil } }] } : {}),
    } }] }],
  });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
  const r = await realFetch(`${base}/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: raw,
  });
  expect(r.status).toBe(200);
  // The handler acks first and processes after; wait for the outbound send.
  for (let i = 0; i < 50 && sent.length < esperados; i++) await new Promise(r => setTimeout(r, 10));
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
    expect(sent[0].text).toContain('Estamos procesando tu registro');
  });

  it('al desconocido le contesta una sola vez', async () => {
    await inbound('593990000055', 'hola');
    expect(sent).toHaveLength(1);
    sent.length = 0;
    await inbound('593990000055', 'hola otra vez');
    expect(sent).toHaveLength(0);
    expect(turns).toHaveLength(0);
  });

  it('says the turn failed instead of answering "…"', async () => {
    brainReply = { status: 500, body: { ok: false, error: 'boom' } };
    await inbound('593990000001', 'hola');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('No pude procesar tu mensaje');
  });
});

describe('aviso de «pensando» con el paciente activo', () => {
  const conPaciente = (texto: string) => ({ status: 200, body: {
    text: texto, session_id: 'sess-wa', active_patient_id: 'p-1',
    status_header: '👤 Juan Pérez — ficha §2.1 Antecedentes',
  } });

  it('enciende el «escribiendo…» y, sin paciente conocido, no manda texto de más', async () => {
    typing.length = 0;
    await inbound('593990000001', 'hola');
    expect(typing).toEqual(['wamid.593990000001']);
    expect(sent.map(s => s.text)).toEqual(['hola doctor']);
  });

  it('desde el segundo turno avisa con quién continúa, antes de la respuesta', async () => {
    brainReply = conPaciente('Paciente activo.');
    await inbound('593990000001', 'ver paciente');
    sent.length = 0;
    brainReply = conPaciente('Anotado.');
    await inbound('593990000001', 'tiene prurito hace dos semanas', undefined, 2);
    expect(sent.map(s => s.text)).toEqual(['⏳ Continuando con Juan Pérez…', 'Anotado.']);
  });

  it('no lo dice cuando el mensaje suelta o cambia al paciente', async () => {
    brainReply = { status: 200, body: { text: 'Listo.', session_id: 'sess-wa' } };
    await inbound('593990000001', 'salir paciente');
    expect(sent.map(s => s.text)).toEqual(['Listo.']);
    // Y ya sin paciente activo, el turno siguiente tampoco.
    sent.length = 0;
    await inbound('593990000001', 'hola');
    expect(sent.map(s => s.text)).toEqual(['Listo.']);
  });
});

describe('ventana de gracia: «Cancelar» antes de que el mensaje se procese', () => {
  const conPaciente = (texto: string) => ({ status: 200, body: {
    text: texto, session_id: 'sess-wa', active_patient_id: 'p-1', status_header: '👤 Juan Pérez',
  } });
  const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Suelta al paciente: si queda activo, los turnos de las suites siguientes
  // llevarían aviso y ventana, y su respuesta caería en otro test.
  afterAll(async () => {
    brainReply = { status: 200, body: { text: 'Listo.', session_id: 'sess-wa' } };
    await inbound('593990000001', 'salir paciente');
    await esperar(250);
  });

  /** Deja la sesión con paciente activo y los registros en cero. */
  async function conPacienteActivo(): Promise<void> {
    brainReply = conPaciente('Paciente activo.');
    await inbound('593990000001', 'ver paciente');
    await esperar(250);                      // que venza cualquier ventana anterior
    sent.length = 0; turns.length = 0; botones.length = 0;
  }

  it('cancelar dentro de la ventana: el mensaje NO llega al cerebro', async () => {
    await conPacienteActivo();
    await inbound('593990000001', 'tiene fiebre');        // sale el aviso y espera
    expect(botones).toHaveLength(1);
    expect(turns).toHaveLength(0);
    await inbound('593990000001', '', undefined, 2, botones[0]);
    await esperar(250);
    expect(turns).toHaveLength(0);
    expect(sent.map(s => s.text)).toEqual(['⏳ Continuando con Juan Pérez…', '🚫 Cancelado: no procesé tu mensaje.']);
  });

  it('cancelar tarde: el mensaje ya se procesó y se le dice', async () => {
    await conPacienteActivo();
    brainReply = conPaciente('Anotado.');
    await inbound('593990000001', 'tiene fiebre', undefined, 2);
    expect(turns).toHaveLength(1);
    sent.length = 0;
    await inbound('593990000001', '', undefined, 1, botones[0]);
    expect(sent.map(s => s.text)).toEqual(['Ese mensaje ya se procesó: no se pudo cancelar.']);
  });

  it('el botón de otro número no cancela el turno', async () => {
    await conPacienteActivo();
    brainReply = conPaciente('Anotado.');
    linked['+593990000002'] = 'otro';
    const turno = inbound('593990000001', 'tiene fiebre', undefined, 2);
    await esperar(40);
    await inbound('593990000002', '', undefined, 3, botones[0]);
    await turno;
    delete linked['+593990000002'];
    expect(turns.map(t => t.message)).toEqual(['tiene fiebre']);
  });
});

describe('phoneCandidates', () => {
  it('tries the bare digits and the "+" form', () => {
    expect(phoneCandidates('593998994582')).toEqual(['593998994582', '+593998994582']);
    expect(phoneCandidates('')).toEqual([]);
  });
});

describe('el canal queda acotado a una organización (PAPER §27.4)', () => {
  beforeEach(() => { sent.length = 0; turns.length = 0; resoluciones.length = 0; });

  it('manda la org en cada resolución: sin eso el turno no está limitado a nadie', async () => {
    await inbound('593990000001', 'hola');
    expect(resoluciones.length).toBeGreaterThan(0);
    for (const r of resoluciones) expect(r.body.org).toBe('cepi');
  });

  it('sin alta automática usa /resolve y el desconocido no entra', async () => {
    delete process.env.WHATSAPP_BOT_AUTOALTA;
    await inbound('593990000098', 'hola');
    expect(resoluciones.every(r => r.ruta === 'resolve')).toBe(true);
    expect(turns).toHaveLength(0);
    expect(sent[0].text).toContain('Estamos procesando tu registro');
  });

  it('con alta automática usa /ensure, avisa una vez y el pendiente no llega al cerebro', async () => {
    process.env.WHATSAPP_BOT_AUTOALTA = '1';
    try {
      await inbound('593990000077', 'hola', 'Juana Pérez');
      expect(resoluciones.every(r => r.ruta === 'ensure')).toBe(true);
      // El nombre del perfil viaja para bautizar la identidad: en la pantalla
      // de aprobación se ve un nombre y no solo un número.
      expect(resoluciones[0].body.name).toBe('Juana Pérez');
      expect(turns).toHaveLength(0);
      expect(sent).toHaveLength(1);
      expect(sent[0].text).toContain('Estamos procesando tu registro');

      // Cada mensaje siguiente cuesta: silencio hasta que lo aprueben.
      sent.length = 0;
      await inbound('593990000077', 'sigo acá');
      await inbound('593990000077', 'hola??');
      expect(sent).toHaveLength(0);
      expect(turns).toHaveLength(0);
    } finally {
      delete process.env.WHATSAPP_BOT_AUTOALTA;
    }
  });

  it('sin organización configurada NO resuelve: falla ruidoso en vez de correr sin límite', async () => {
    const org = process.env.TELEGRAM_BOT_ORG;
    delete process.env.TELEGRAM_BOT_ORG;
    delete process.env.WHATSAPP_BOT_ORG;
    delete process.env.CEPI_BOT_ORG;
    try {
      await inbound('593990000001', 'hola');
      expect(resoluciones).toHaveLength(0);   // ni siquiera se intenta
      expect(turns).toHaveLength(0);          // el cerebro no se toca
      expect(sent[0].text).toContain('Estamos procesando tu registro');
      // Error de configuración: se repite en cada mensaje, se avisa una vez por hora.
      sent.length = 0;
      await inbound('593990000001', 'hola?');
      expect(sent).toHaveLength(0);
    } finally {
      if (org) process.env.TELEGRAM_BOT_ORG = org;
    }
  });
});

describe('aviso de registro listo (TodoERP → /interno/identidad-activada)', () => {
  const avisar = (external_id: string, platform = 'whatsapp') =>
    realFetch(`${base}/interno/identidad-activada`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'identity.activated', platform, external_id }),
    }).then(r => r.json());

  it('al aprobado le escribe una vez, por su nombre', async () => {
    expect((await avisar('+593990000001')).resultado).toBe('enviado');
    expect(sent).toEqual([{ to: '593990000001',
      text: expect.stringContaining('Hola, Ana. Tu registro en CEPI Telemedicina está listo') }]);
    sent.length = 0;
    expect((await avisar('593990000001')).resultado).toBe('omitido');
    expect(sent).toHaveLength(0);
  });

  it('no le cree al aviso: si el número sigue pendiente, no escribe', async () => {
    altas.add('593990000066');
    expect((await avisar('593990000066')).resultado).toBe('omitido');
    expect(sent).toHaveLength(0);
  });

  it('ni a un número que no existe, ni por otro canal', async () => {
    expect((await avisar('593990000011')).resultado).toBe('omitido');
    expect((await avisar('12345', 'telegram')).resultado).toBe('omitido');
    expect(sent).toHaveLength(0);
  });

  it('rechaza lo que llega por nginx (con X-Forwarded-For)', async () => {
    const r = await realFetch(`${base}/interno/identidad-activada`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ platform: 'whatsapp', external_id: '593990000001' }),
    });
    expect(r.status).toBe(403);
  });
});
