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
import { emitirTurnoDePaciente } from '../src/canalEco.js';

const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64') + '.s';
const FROM = '593990000001';

interface Salida { text: string; botones: Array<{ id: string; title: string }>; }
const sent: Salida[] = [];
/** Cuerpos que recibió el cerebro. */
const turnos: any[] = [];
/** Si está, Meta rechaza los mensajes interactivos (para probar la caída a texto). */
let rechazarBotones = false;
/** El hilo del paciente que devuelve TodoERP, y quién lo leyó. */
let hilo: any[] = [];
const lecturasDeHilo: Array<{ url: string; auth: string }> = [];
/** Ids de media que el bot le pidió a Meta, y lo que subió a TodoERP. */
const descargas: string[] = [];
const subidas: Array<{ auth: string; nombre: string; tipo: string; bytes: number }> = [];
/** Los últimos botones que vio la persona: sobreviven al beforeEach, como en su pantalla. */
let vistos: Array<{ id: string; title: string }> = [];

const realFetch = globalThis.fetch;
function mockFetch(): void {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const json = (status: number, body: any) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    // Imagen entrante: Meta da primero la URL del archivo y después el contenido.
    if (u.includes('graph.facebook.com') && (!init?.method || init.method === 'GET')) {
      descargas.push(u.split('/').pop()!);
      return json(200, { url: 'https://lookaside.test/media/' + u.split('/').pop(), mime_type: 'image/jpeg' });
    }
    if (u.startsWith('https://lookaside.test/media/')) {
      if (init?.headers?.Authorization !== 'Bearer test-token') return json(401, {});
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
    }
    if (u.includes('/api/patient-thread')) {
      lecturasDeHilo.push({ url: u, auth: init.headers.authorization });
      return json(200, { ok: true, messages: hilo });
    }
    if (u.endsWith('/api/attachments')) {
      const f = (init.body as FormData).get('file') as File;
      subidas.push({ auth: init.headers.authorization, nombre: f.name, tipo: f.type, bytes: f.size });
      return json(200, [{ id: `00000000-0000-4000-8000-00000000000${subidas.length}` }]);
    }
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
    { key: 'foto', label: 'Imágenes de la lesión', type: 'image_upload', multiple: true },
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
  if (/\[adjunto:/.test(msg)) return { status: 200, body: { ...base, text: '¿Esta imagen es de la lesión o un formulario de consentimiento?', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba',
    quick_replies: [{ label: '🔬 Imagen de lesión', send: 'imagen lesion' }, { label: '📄 Consentimiento', send: 'imagen consentimiento' }] } };
  if (/^salir paciente$/i.test(msg)) return { status: 200, body: { ...base, text: 'Paciente activo limpiado.', active_patient_id: null } };
  if (/^activar paciente /i.test(msg)) return { status: 200, body: { ...base, session_id: body.session_id || 'sess-nueva', text: 'Paciente activo: Otro.', active_patient_id: msg.split(' ').pop(), status_header: '👤 Otro' } };
  if (/^nota /i.test(msg)) return { status: 200, body: { ...base, text: 'Anotado.', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba' } };
  if (/^omitir ficha$/i.test(msg)) return { status: 200, body: { ...base, text: 'Sección omitida.', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba' } };
  return { status: 200, body: { ...base, text: 'Escribe «nuevo paciente» para crear uno.', quick_replies: ATAJOS } };
}

let server: ReturnType<typeof startWhatsapp>;
let base = '';

/** Manda un mensaje firmado como Meta y espera a que el bot deje de escribir. */
async function manda(m: { text?: string; boton?: string; imagen?: string; caption?: string }): Promise<void> {
  const antes = sent.length;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [m.imagen
    ? { from: FROM, id: 'wamid.in', type: 'image', image: { id: m.imagen, mime_type: 'image/jpeg', ...(m.caption ? { caption: m.caption } : {}) } }
    : m.boton
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

  it('el número elige la opción y el campo de imágenes pide la foto, sin «Listo» todavía', async () => {
    await manda({ text: '3' });
    expect(ultimo().text).toBe('(3/4) Imágenes de la lesión\nEnvía la(s) imagen(es) como foto.');
    expect(ultimo().botones.map(b => b.title)).toEqual(['Omitir']);
  });

  it('texto en el campo de imágenes no se guarda como si fuera una foto', async () => {
    await manda({ text: 'ya la mando' });
    expect(sent[0].text).toBe('Aquí va una foto, no texto.');
    expect(turnos).toHaveLength(0);
  });

  it('cada foto se baja de Meta, se sube a nombre del médico y se cuenta', async () => {
    await manda({ imagen: 'media-1' });
    expect(descargas).toEqual(['media-1']);
    expect(subidas).toEqual([{ auth: `Bearer ${jwt}`, nombre: 'whatsapp_media-1.jpg', tipo: 'image/jpeg', bytes: 4 }]);
    expect(ultimo().text).toBe('(3/4) Imágenes de la lesión\n📷 1 imagen recibida. Envía otra o toca «Listo».');
    expect(ultimo().botones.map(b => b.title)).toEqual(['Listo', 'Omitir']);
    await manda({ imagen: 'media-2' });
    expect(ultimo().text).toContain('2 imágenes recibidas');
    expect(turnos).toHaveLength(0);                    // nada va al cerebro hasta enviar la sección
  });

  it('«Listo» cierra el campo y la sección se envía con los ids de las fotos', async () => {
    await manda({ boton: boton('Listo') });
    expect(ultimo().text).toBe('(4/4) Observaciones');
    await manda({ text: 'sin novedades' });
    expect(turnos).toHaveLength(1);
    expect(turnos[0].form_submission).toEqual({
      form_id: 'ficha_grp_g_2_1', data: { fuma: false, fototipo: 'III', obs: 'sin novedades',
        foto: '00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002' } });
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

describe('WhatsApp: imagen fuera de un campo de imágenes', () => {
  it('suelta, va al cerebro con el marcador de adjunto y el texto de la foto', async () => {
    await manda({ text: 'cancelar' });
    turnos.length = 0;
    await manda({ imagen: 'media-3', caption: 'lesión en la pierna' });
    expect(turnos.at(-1).message).toBe('lesión en la pierna\n[adjunto: whatsapp_media-3.jpg · 00000000-0000-4000-8000-000000000003]');
    expect(ultimo().botones.map(b => b.title)).toEqual(['🔬 Imagen de lesión', '📄 Consentimiento']);
  });

  it('durante el alta de paciente se rechaza: todavía no hay a quién ligarla', async () => {
    await manda({ text: 'nuevo paciente' });
    const antes = subidas.length; turnos.length = 0;
    const desde = sent.length;
    await manda({ imagen: 'media-4' });
    expect(subidas.length).toBe(antes);
    expect(turnos).toHaveLength(0);
    expect(sent[desde].text).toContain('todavía no puedo recibir imágenes');
    expect(ultimo().text).toBe('(1/3) Cédula (Ej: 12345678)');
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

describe('WhatsApp: eco del hilo del paciente activo', () => {
  const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));
  const enUnRato = () => new Date(Date.now() + 1000).toISOString();
  const OTRO = '22222222-2222-4222-8222-222222222222';

  it('lo que se escribe en la web sobre el paciente activo llega al teléfono', async () => {
    await manda({ text: 'cancelar' });
    await manda({ text: 'nota control en 7 días' });          // deja a p-1 activo en sess-wa
    sent.length = 0; lecturasDeHilo.length = 0;
    hilo = [
      { session_id: 'sess-wa', role: 'user', content: 'nota control en 7 días', ts: enUnRato(), author_name: 'Ana' },
      { session_id: 'sess-web', role: 'user', content: 'Revisé las fotos, parece queratosis', ts: enUnRato(), author_name: 'Dra. Derma' },
      { session_id: 'sess-web', role: 'assistant', content: 'Paciente activo: Paciente Prueba', ts: enUnRato(), is_bot: true },
      { session_id: 'sess-web', role: 'assistant', content: 'Anotado en la ficha.', ts: enUnRato(), is_bot: true },
      { session_id: 'sess-web', role: 'user', content: 'viejo', ts: '2020-01-01T00:00:00Z', author_name: 'Dra. Derma' },
    ];
    emitirTurnoDePaciente({ patientId: 'p-1', sessionId: 'sess-web' });
    await esperar(150);
    // Lee el hilo con el JWT del usuario del número: recibe lo que vería en la web.
    expect(lecturasDeHilo).toEqual([{ url: expect.stringContaining('patient_id=p-1'), auth: `Bearer ${jwt}` }]);
    // Ni lo suyo, ni lo anterior a tener al paciente activo, ni el acuse de activación.
    expect(sent.map(s => s.text)).toEqual([
      '💬 *Dra. Derma*\nRevisé las fotos, parece queratosis', '🤖 *Asistente*\nAnotado en la ficha.']);
  });

  it('no repite lo ya enviado, y un turno propio no dispara eco', async () => {
    sent.length = 0;
    emitirTurnoDePaciente({ patientId: 'p-1', sessionId: 'sess-web' });
    emitirTurnoDePaciente({ patientId: 'p-1', sessionId: 'sess-wa' });
    await esperar(150);
    expect(sent).toEqual([]);
  });

  it('el turno de otro paciente no le llega', async () => {
    sent.length = 0; lecturasDeHilo.length = 0;
    emitirTurnoDePaciente({ patientId: 'p-otro', sessionId: 'sess-web' });
    await esperar(100);
    expect(lecturasDeHilo).toEqual([]);
  });

  it('activar a otro paciente empieza una sesión nueva y corta el eco del anterior', async () => {
    await manda({ text: `activar paciente ${OTRO}` });
    expect(turnos.at(-1).session_id).toBeUndefined();        // no arrastra la sesión de p-1
    sent.length = 0; lecturasDeHilo.length = 0;
    hilo = [{ session_id: 'sess-web', role: 'user', content: 'otro mensaje sobre p-1', ts: enUnRato(), author_name: 'Dra. Derma' }];
    emitirTurnoDePaciente({ patientId: 'p-1', sessionId: 'sess-web' });
    await esperar(100);
    expect(sent).toEqual([]);
    expect(lecturasDeHilo).toEqual([]);
  });

  it('«salir paciente» en medio de una sección sale del recorrido, no se guarda como respuesta', async () => {
    await manda({ text: 'nuevo paciente' });
    await manda({ text: '111' }); await manda({ text: 'A' }); await manda({ text: 'B' });   // abre la ficha
    expect(ultimo().text).toBe('(1/4) ¿Fuma?');
    turnos.length = 0;
    await manda({ text: 'salir paciente' });
    expect(turnos.map(t => t.message)).toEqual(['salir paciente']);
    expect(ultimo().text).toBe('Paciente activo limpiado.');
  });

  it('al soltar al paciente la sesión termina con él', async () => {
    await manda({ text: 'nota x' });
    await manda({ text: 'salir paciente' });
    await manda({ text: 'hola' });
    expect(turnos.at(-1).session_id).toBeUndefined();
  });
});
