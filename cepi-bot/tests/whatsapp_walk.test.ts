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
/** Tipo de cada mensaje interactivo que salió: `button` o `list`. */
const tipos: string[] = [];
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
        // Botones de respuesta, o las filas de una lista desplegable.
        vistos = b.interactive.type === 'list'
          ? b.interactive.action.sections[0].rows.map((x: any) => ({ id: x.id, title: x.title }))
          : b.interactive.action.buttons.map((x: any) => x.reply);
        tipos.push(b.interactive.type);
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
  const BUSQUEDA = { id: 'patient_search', title: 'Buscar paciente', fields: [{ key: 'patient', label: 'Cédula o nombre', type: 'entity_search' }],
    actions: [{ label: '+ Nuevo paciente', send: 'nuevo paciente' }] };
  if (/^buscar varios$/i.test(msg)) return { status: 200, body: { ...base, text: 'Resultados:\n1. Ana Pérez\n2. María Fernanda de los Ángeles', form: BUSQUEDA, status_header: '📋 Buscando paciente', quick_replies: [
    { label: 'Ana Pérez', send: 'activar paciente 11111111-1111-4111-8111-111111111111' },
    { label: 'María Fernanda de los Ángeles', send: 'activar paciente 22222222-2222-4222-8222-222222222222' },
    { label: '+ Nuevo paciente', send: 'nuevo paciente' }] } };
  if (/^buscar uno$/i.test(msg)) return { status: 200, body: { ...base, text: 'Resultados:\n1. Otro', form: BUSQUEDA, status_header: '📋 Buscando paciente', quick_replies: [
    { label: 'Otro', send: 'activar paciente 33333333-3333-4333-8333-333333333333' },
    { label: '+ Nuevo paciente', send: 'nuevo paciente' }] } };
  if (/^ficha sexo$/i.test(msg)) return { status: 200, body: { ...base, text: '1.3 Sexo:', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba',
    form: { id: 'ficha_grp_g_1_3', title: '1.3 Sexo', submit_mode: 'structured',
      fields: [{ key: 'sexo', label: 'Sexo', type: 'radio', options: ['M', 'F', 'Otro'] }], actions: [{ label: 'Omitir', send: 'omitir ficha' }] } } };
  if (/^ficha fecha$/i.test(msg)) return { status: 200, body: { ...base, text: '1.2 Fecha de nacimiento:', active_patient_id: 'p-1', status_header: '👤 Paciente Prueba',
    form: { id: 'ficha_grp_g_1_2', title: '1.2 Fecha de nacimiento', submit_mode: 'structured',
      fields: [{ key: 'fecha_nac', label: 'Fecha de nacimiento', type: 'date' }], actions: [{ label: 'Omitir', send: 'omitir ficha' }] } } };
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
    expect(ultimo().botones.map(b => b.title)).toEqual(['Sí', 'No', 'Saltar']);
  });
});

describe('WhatsApp: recorrido de una sección de la ficha', () => {
  it('una pregunta cerrada contestada con otra cosa se vuelve a preguntar', async () => {
    await manda({ text: 'a veces' });
    expect(sent.map(s => s.text)).toEqual(['Elige una de las opciones.', '(1/4) ¿Fuma?']);
    expect(turnos).toHaveLength(0);
  });

  it('«no» escrito vale como el botón; más de 3 opciones salen como lista desplegable', async () => {
    await manda({ text: 'no' });
    expect(tipos.at(-1)).toBe('list');
    expect(ultimo().text).toBe('(2/4) Fototipo');
    expect(ultimo().botones.map(b => b.title)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'Saltar', 'Omitir restante']);
  });

  it('la fila elegida responde el campo, y el de imágenes pide la foto sin «Listo» todavía', async () => {
    await manda({ boton: boton('III') });
    expect(ultimo().text).toBe('(3/4) Imágenes de la lesión\nEnvía la(s) imagen(es) como foto.');
    expect(ultimo().botones.map(b => b.title)).toEqual(['Saltar', 'Omitir restante']);
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
    expect(ultimo().botones.map(b => b.title)).toEqual(['Listo', 'Saltar', 'Omitir restante']);
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

  it('una salida que viene dos veces (cerebro y formulario) sale una sola: Meta rechaza títulos repetidos', async () => {
    await manda({ text: 'buscar varios' });
    expect(tipos.at(-1)).toBe('button');
    expect(ultimo().botones.map(b => b.title)).toEqual(['Ana Pérez', 'María Fernanda de l…', '+ Nuevo paciente']);
    // No pinta el formulario de búsqueda debajo de los resultados.
    expect(ultimo().text).not.toContain('Cédula o nombre');
  });

  it('la búsqueda con un único resultado activa al paciente sin hacerle elegir', async () => {
    turnos.length = 0; sent.length = 0;
    await manda({ text: 'buscar uno' });
    expect(turnos.map(t => t.message)).toEqual(['buscar uno', 'activar paciente 33333333-3333-4333-8333-333333333333']);
    expect(sent.map(s => s.text)).toEqual(['👤 Otro\nPaciente activo: Otro.']);
    await manda({ text: 'salir paciente' });
  });

  it('si Meta rechaza los botones, las opciones salen numeradas y el número funciona', async () => {
    rechazarBotones = true;
    await manda({ text: 'menú' });
    expect(ultimo().text).toContain('1. Nuevo paciente\n2. Buscar paciente\n3. Paciente anterior');
    await manda({ text: '1' });
    expect(turnos.at(-1).message).toBe('nuevo paciente');
  });
});

describe('WhatsApp: saltar un campo no es omitir la sección', () => {
  /** Abre el alta y deja el recorrido en la primera pregunta de la ficha. */
  async function abrirFicha(): Promise<void> {
    await manda({ text: 'cancelar' });
    await manda({ text: 'nuevo paciente' });
    await manda({ text: '111' }); await manda({ text: 'A' }); await manda({ text: 'B' });
    expect(ultimo().text).toBe('(1/4) ¿Fuma?');
    turnos.length = 0; sent.length = 0;
  }

  it('la presentación de la sección explica las dos salidas', async () => {
    await manda({ text: 'cancelar' });
    await manda({ text: 'nuevo paciente' });
    await manda({ text: '111' }); await manda({ text: 'A' });
    sent.length = 0;
    await manda({ text: 'B' });
    expect(sent[0].text).toContain('«Saltar» deja un campo sin contestar. «Omitir restante» (o escribirlo) termina la sección: lo ya contestado se guarda.');
  });

  it('«Saltar» deja ese campo sin contestar y sigue con el siguiente', async () => {
    await abrirFicha();
    await manda({ boton: boton('Saltar') });
    expect(ultimo().text).toBe('(2/4) Fototipo');
    expect(turnos).toHaveLength(0);
  });

  it('«Omitir restante» con respuestas las GUARDA: envía la sección con lo contestado', async () => {
    await abrirFicha();
    await manda({ boton: boton('Sí') });
    await manda({ text: 'omitir restante' });
    expect(turnos).toHaveLength(1);
    expect(turnos[0].form_submission).toEqual({ form_id: 'ficha_grp_g_2_1', data: { fuma: true } });
    expect(ultimo().text).toBe('👤 Paciente Prueba\nAntecedentes guardados.');
  });

  it('«Omitir restante» sin ninguna respuesta la omite', async () => {
    await abrirFicha();
    await manda({ text: 'omitir restante' });
    expect(turnos.map(t => t.message)).toEqual(['omitir ficha']);
  });

  it('salir de la sección por otro camino también guarda lo contestado', async () => {
    await abrirFicha();
    await manda({ boton: boton('No') });
    await manda({ text: 'salir paciente' });
    // Lo único que va al cerebro es el guardado; soltar al paciente lo hace el canal.
    expect(turnos).toHaveLength(1);
    expect(turnos[0].form_submission).toEqual({ form_id: 'ficha_grp_g_2_1', data: { fuma: false } });
    expect(sent.map(s => s.text)).toContain('💾 Guardé lo que llevabas de «2.1 Antecedentes».');
    expect(sent.map(s => s.text)).toContain('Listo, dejé a *Paciente Prueba*.');
  });
});

describe('WhatsApp: una pregunta de tres opciones sale con sus tres botones', () => {
  it('no se esconde detrás de «Ver opciones»; las salidas se escriben', async () => {
    await manda({ text: 'cancelar' });
    await manda({ text: 'ficha sexo' });
    expect(tipos.at(-1)).toBe('button');
    expect(ultimo().botones.map(b => b.title)).toEqual(['M', 'F', 'Otro']);
    turnos.length = 0;
    await manda({ text: 'saltar' });
    expect(turnos.map(t => t.message)).toEqual(['omitir ficha']);     // única pregunta, sin respuesta: se omite
  });
});

describe('WhatsApp: una fecha escrita a mano', () => {
  it('«1 enero 2000» se guarda como fecha, no como texto que el backend rechaza', async () => {
    await manda({ text: 'cancelar' });
    await manda({ text: 'ficha fecha' });
    expect(ultimo().text).toBe('(1/1) Fecha de nacimiento');
    turnos.length = 0;
    await manda({ text: '1 enero 2000' });
    expect(turnos[0].form_submission).toEqual({ form_id: 'ficha_grp_g_1_2', data: { fecha_nac: '2000-01-01' } });
  });

  it('lo que ningún validador entiende no se guarda: lo dice y vuelve a preguntar', async () => {
    await manda({ text: 'ficha fecha' });
    turnos.length = 0; sent.length = 0;
    await manda({ text: 'cuando llovía' });
    expect(turnos).toHaveLength(0);
    expect(sent.map(s => s.text)).toEqual([
      'No entendí «cuando llovía» como una fecha (por ejemplo 15/03/1990).', '(1/1) Fecha de nacimiento']);
  });
});

describe('WhatsApp: imagen fuera de un campo de imágenes', () => {
  it('suelta, va al cerebro con el marcador de adjunto y el texto de la foto', async () => {
    await manda({ text: 'cancelar' });
    turnos.length = 0;
    await manda({ imagen: 'media-3', caption: 'lesión en la pierna' });
    expect(turnos.at(-1).message).toMatch(/^lesión en la pierna\n\[adjunto: whatsapp_media-3\.jpg · 00000000-0000-4000-8000-00000000000\d\]$/);
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
      { session_id: 'sess-web', role: 'user', content: 'Revisé las fotos, parece queratosis', ts: enUnRato(), author_name: 'Dra. Derma', contenido: true },
      // Lo que el bot le contestó a ella, y sus maniobras, son de SU conversación.
      { session_id: 'sess-web', role: 'assistant', content: '¿Esta imagen es de la lesión o un consentimiento?', ts: enUnRato(), is_bot: true, contenido: false },
      { session_id: 'sess-web', role: 'user', content: 'omitir ficha', ts: enUnRato(), author_name: 'Dra. Derma', contenido: false },
      { session_id: 'sess-web', role: 'user', content: 'viejo', ts: '2020-01-01T00:00:00Z', author_name: 'Dra. Derma', contenido: true },
    ];
    emitirTurnoDePaciente({ patientId: 'p-1', sessionId: 'sess-web' });
    await esperar(150);
    // Lee el hilo con el JWT del usuario del número: recibe lo que vería en la web.
    expect(lecturasDeHilo).toEqual([{ url: expect.stringContaining('patient_id=p-1'), auth: `Bearer ${jwt}` }]);
    // Ni lo suyo, ni lo anterior a tener al paciente activo, ni las preguntas del
    // bot a otra persona: un eco nunca trae una respuesta del bot.
    expect(sent.map(s => s.text)).toEqual(['💬 *Dra. Derma*\nRevisé las fotos, parece queratosis']);
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
    hilo = [{ session_id: 'sess-web', role: 'user', content: 'otro mensaje sobre p-1', ts: enUnRato(), author_name: 'Dra. Derma', contenido: true }];
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
    // No se guarda como respuesta del campo, ni llega al cerebro: allá le borraría
    // el paciente a la sesión y la conversación saldría del chat del paciente.
    expect(turnos).toHaveLength(0);
    expect(sent.map(s => s.text)).toContain('Listo, dejé a *Paciente Prueba*.');
    expect(ultimo().text).toContain('¿Qué quieres hacer?');
  });

  it('buscar otro paciente con uno activo: lo deja y busca en una sesión limpia', async () => {
    await manda({ text: 'nota control' });                 // p-1 activo en sess-wa
    turnos.length = 0; sent.length = 0;
    await manda({ text: 'buscar paciente' });
    // El pedido no llega al cerebro dentro de la sesión del paciente anterior.
    expect(turnos.map(t => [t.message, t.session_id])).toEqual([['buscar paciente', undefined]]);
    expect(sent[0].text).toBe('Dejé a *Paciente Prueba*.');
    // Y dejó de recibir el eco de ese paciente.
    lecturasDeHilo.length = 0;
    emitirTurnoDePaciente({ patientId: 'p-1', sessionId: 'sess-web' });
    await new Promise(r => setTimeout(r, 100));
    expect(lecturasDeHilo).toEqual([]);
  });

  it('al soltar al paciente la sesión termina con él', async () => {
    await manda({ text: 'nota x' });
    await manda({ text: 'salir paciente' });
    await manda({ text: 'hola' });
    expect(turnos.at(-1).session_id).toBeUndefined();
  });
});

describe('WhatsApp: el paciente activo dura minutos', () => {
  const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));
  afterAll(() => { delete process.env.CEPI_CANAL_INACTIVIDAD_MS; });

  it('al cumplirse el rato de inactividad avisa de la pausa, sin esperar al mensaje siguiente', async () => {
    process.env.CEPI_CANAL_INACTIVIDAD_MS = '120';
    await manda({ text: 'nota control' });                 // p-1 activo; arma el reloj
    sent.length = 0;
    await esperar(260);
    expect(sent.map(s => s.text)).toEqual(['⏸️ Pausé la consulta de *Paciente Prueba* por inactividad.\n¿Sigues con *Paciente Prueba*?']);
    expect(ultimo().botones.map(b => b.title)).toEqual(['Sí, continuar', 'Cambiar paciente']);
  });

  it('un mensaje con la consulta en pausa se retiene y se vuelve a preguntar', async () => {
    turnos.length = 0; sent.length = 0;
    await manda({ text: 'tiene fiebre desde ayer' });
    expect(turnos).toHaveLength(0);
    expect(ultimo().text).toBe('¿Sigues con *Paciente Prueba*?');
    expect(ultimo().botones.map(b => b.title)).toEqual(['Sí, continuar', 'Cambiar paciente']);
  });

  it('mientras la pregunta está pendiente no recibe eco del hilo', async () => {
    sent.length = 0; lecturasDeHilo.length = 0;
    emitirTurnoDePaciente({ patientId: 'p-1', sessionId: 'sess-web' });
    await esperar(80);
    expect(lecturasDeHilo).toEqual([]);
  });

  it('«Sí» procesa el mensaje retenido en la misma sesión', async () => {
    await manda({ boton: boton('Sí, continuar') });
    expect(turnos.map(t => [t.message, t.session_id])).toEqual([['tiene fiebre desde ayer', 'sess-wa']]);
  });

  it('«Sí» al aviso, sin mensaje retenido, retoma y no manda nada al cerebro', async () => {
    await esperar(260);                                    // vuelve a pausarse
    turnos.length = 0; sent.length = 0;
    await manda({ boton: boton('Sí, continuar') });
    expect(turnos).toHaveLength(0);
    expect(sent.map(s => s.text)).toEqual(['▶️ Continuamos con *Paciente Prueba*.']);
  });

  it('«Cambiar paciente» descarta el mensaje y muestra el menú', async () => {
    await esperar(260);
    turnos.length = 0; sent.length = 0;
    await manda({ text: 'esto era de otro paciente' });
    await manda({ boton: boton('Cambiar paciente') });
    expect(turnos).toHaveLength(0);
    expect(sent.map(s => s.text).slice(-2)).toEqual([
      'No procesé tu mensaje anterior.', 'Hola 👋 ¿Qué quieres hacer?\nPaciente anterior: Paciente Prueba']);
  });

  it('quien vuelve cambiando de paciente no recibe la pregunta', async () => {
    await manda({ text: 'nota x' });                       // p-1 activo otra vez
    await esperar(260);
    turnos.length = 0; sent.length = 0;
    await manda({ text: 'salir paciente' });
    expect(turnos).toHaveLength(0);
    expect(sent[0].text).toBe('Listo, dejé a *Paciente Prueba*.');     // sin «¿Sigues con…?»
  });
});
