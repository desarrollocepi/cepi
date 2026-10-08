/**
 * WhatsApp Cloud API adapter for cepi-bot.
 *
 * Runs a second Express listener (default :9997) that receives Meta webhook
 * callbacks and routes every inbound text message through the SAME chat brain
 * the medical frontend uses (`invokeChat` in server.ts). The bot's structured
 * reply (text + optional BotForm + quick replies) is degraded to plain
 * WhatsApp messages, since WhatsApp can't render inline forms.
 *
 * Env:
 *   WHATSAPP_WEBHOOK_PORT   listen port (default 9997)
 *   WHATSAPP_VERIFY_TOKEN   token Meta echoes back on GET verification
 *   WHATSAPP_TOKEN          Cloud API bearer token (to send replies)
 *   WHATSAPP_PHONE_ID       Cloud API phone-number id (to send replies)
 *   WHATSAPP_APP_SECRET     app secret of the Meta app; signs every POST
 *                           (X-Hub-Signature-256). Unset ⇒ every POST is refused.
 *   WHATSAPP_BOT_EMAIL / WHATSAPP_BOT_PASSWORD   cuenta de servicio del canal
 *                           (rol `bot_canal`: solo resuelve, da de alta y
 *                           vincula identidades). Cae a TELEGRAM_BOT_* si falta.
 *   WHATSAPP_BOT_ORG        OBLIGATORIA. Organización a la que queda acotado el
 *                           canal (slug o uuid, p. ej. `cepi`). Sin ella no se
 *                           resuelve nada: un turno sin org activa no está
 *                           limitado a nadie (PAPER §27.4).
 *   WHATSAPP_BOT_AUTOALTA   '1' ⇒ un remitente desconocido se da de alta como
 *                           identidad en rol `pendiente`, sin acceso clínico,
 *                           para que un admin la vincule a su cuenta. Sin esto,
 *                           se mantiene el "no estás registrado". En los dos
 *                           casos el desconocido recibe UNA respuesta y después
 *                           silencio: ni LLM ni mensaje saliente.
 *
 * Auth model (same as the Telegram adapter): cada número entrante se resuelve
 * contra /api/auth/external/{resolve,ensure} y el turno corre COMO esa persona,
 * con su rol y sus permisos. Si el número es una **identidad hija** (§27), el
 * turno corre como su cuenta **padre**. Un número que no alcanza a nadie de la
 * organización del bot recibe "no registrado" y nunca llega al cerebro — el
 * número es público, así que cualquiera puede escribir. Cada número se mapea a
 * un bot_session persistido, cacheado acá en memoria.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Request, Response } from 'express';
import type { BotForm, BotFormField, QuickReply } from './flowV1.js';
import {
  abrirGracia, avisoContinuando, cancelarGracia, graciaMs, inactividadMs, pacienteDeRespuesta,
  TXT_CANCELAR, TXT_CANCELADO, TXT_TARDE,
} from './canalAviso.js';
import {
  colaPorChat, cuerpoDeEnvio, isWalkableForm, posicion, ultimoCampo, walkOptions, yaTieneValor, type FormWalk,
} from './canalWalk.js';
import { crearRegistroCrudo } from './canalRaw.js';
import { extensionDe, marcadorAdjunto, nombreDeAdjunto, subirAdjunto } from './canalAdjuntos.js';
import { crearEco } from './canalEco.js';
import { ayudaDeTipo, legible, tipoEsperado, validarRespuesta } from './validarCampo.js';
import { crearEstado } from './canalEstado.js';

/** Cached service-account JWT + its expiry (epoch seconds). */
let svcJwt: { token: string; exp: number } | null = null;

/**
 * Return a valid service-account JWT, logging in to TodoERP when missing or
 * within 60s of expiry. This admin account only resolves phones to users — it
 * is NOT the identity messages act with. Returns '' when not configured.
 */
async function getServiceJwt(): Promise<string> {
  const email = process.env.WHATSAPP_BOT_EMAIL || process.env.TELEGRAM_BOT_EMAIL;
  const password = process.env.WHATSAPP_BOT_PASSWORD || process.env.TELEGRAM_BOT_PASSWORD;
  if (!email || !password) return '';

  const now = Math.floor(Date.now() / 1000);
  if (svcJwt && svcJwt.exp - 60 > now) return svcJwt.token;

  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  try {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data: any = await r.json().catch(() => ({}));
    const token = data?.token || data?.data?.token || '';
    if (!token) { console.error('[whatsapp] login: no token in response'); return ''; }
    let exp = now + 3600;
    try { exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')).exp || exp; } catch {}
    svcJwt = { token, exp };
    return token;
  } catch (e: any) {
    console.error('[whatsapp] service login failed:', e?.message || e);
    return '';
  }
}

type ResolveResult =
  /** `pendiente`: identidad sin aprobar (rol `pendiente`, sin padre). `creada`: nació en esta llamada. */
  | { ok: true; jwt: string; pendiente: boolean; creada: boolean; nombre?: string }
  | { ok: false; reason: 'unregistered' | 'error' };

/** Rol con el que `/auth/external/ensure` da de alta al desconocido (PAPER §27.4). */
const ROL_PENDIENTE = 'pendiente';

/**
 * The forms a WhatsApp `from` (digits, no "+") may have been typed in when an
 * admin linked it on the user: as-is and with a leading "+".
 */
export function phoneCandidates(from: string): string[] {
  const digits = from.replace(/\D/g, '');
  return digits ? [digits, `+${digits}`] : [];
}

/**
 * Resolve the TodoERP user linked to a WhatsApp phone and return a JWT to act
 * AS that user. `unregistered` ⇒ no active user has this number.
 */
async function resolveUserAuth(
  from: string, nombre?: string, soloResolver = false,
): Promise<ResolveResult> {
  const adminJwt = await getServiceJwt();
  if (!adminJwt) {
    console.error('[whatsapp] no service account configured to resolve identity');
    return { ok: false, reason: 'error' };
  }
  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  // La organización acota a quién alcanza este número (PAPER §27.4). Va por
  // configuración porque el ERP no sabe qué es telemedicina; sin ella el turno
  // correría sin org activa, que es no estar limitado a nada.
  // Cae a la de Telegram igual que la cuenta de servicio, unas líneas más
  // arriba: en prod los dos canales comparten configuración.
  const org = process.env.WHATSAPP_BOT_ORG || process.env.TELEGRAM_BOT_ORG
    || process.env.CEPI_BOT_ORG || '';
  if (!org) {
    console.error('[whatsapp] falta WHATSAPP_BOT_ORG: sin organización no se resuelve');
    return { ok: false, reason: 'error' };
  }
  // Con alta automática, el remitente desconocido pasa a existir como identidad
  // en rol `pendiente` (sin acceso clínico) y un admin la vincula después a su
  // cuenta real. Sin el flag se mantiene el «no estás registrado» de siempre.
  const daDeAlta = !soloResolver && process.env.WHATSAPP_BOT_AUTOALTA === '1';
  const ruta = daDeAlta ? 'ensure' : 'resolve';
  try {
    for (const externalId of phoneCandidates(from)) {
      const r = await fetch(`${base}/api/auth/external/${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ platform: 'whatsapp', external_id: externalId, org, ...(nombre ? { name: nombre } : {}) }),
      });
      if (r.status === 404) continue;
      if (!r.ok) { console.error('[whatsapp] resolve failed', r.status); return { ok: false, reason: 'error' }; }
      const data: any = await r.json().catch(() => ({}));
      if (!data?.token) return { ok: false, reason: 'error' };
      return {
        ok: true,
        jwt: data.token,
        pendiente: data?.user?.role === ROL_PENDIENTE,
        creada: data?.creada === true,
        nombre: data?.user?.name,
      };
    }
    return { ok: false, reason: 'unregistered' };
  } catch (e: any) {
    console.error('[whatsapp] resolve error:', e?.message || e);
    return { ok: false, reason: 'error' };
  }
}

type InvokeChat = (input: {
  body: any;
  headers?: Record<string, string>;
}) => Promise<{ status: number; body: any }>;

/** phone (E.164, no +) → cepi-bot session_id. In-memory: fine for testing. */
const phoneSessions = new Map<string, string>();

/** phone → nombre del paciente activo en su sesión, para el aviso de «pensando». */
const pacienteActivo = new Map<string, string>();

/** phone → hora del último mensaje entrante. */
const ultimoEntrante = new Map<string, number>();
/** Meta solo deja escribirle a un número dentro de las 24 h desde su último mensaje. */
const VENTANA_META_MS = 24 * 60 * 60 * 1000;

/**
 * phone → mensaje retenido mientras se pregunta «¿Sigues con X?» (ver
 * `preguntarSiSigue`). `adoptar`: la sesión a retomar si contesta que sí, cuando
 * el paciente activo se recuperó de la base tras un reinicio.
 */
interface EnEspera { entrada?: Entrada; nombre: string; adoptar?: { id: string; patientId: string }; }
const enEspera = new Map<string, EnEspera>();
/** phone → reloj que avisa cuando el paciente activo se pausa por inactividad. */
const relojesDePausa = new Map<string, ReturnType<typeof setTimeout>>();
/** Números a los que ya se les buscó la sesión anterior en este proceso. */
const buscados = new Set<string>();

/** phone → último paciente activo, para ofrecerlo en el menú. */
const lastPatient = new Map<string, { id: string; name: string }>();

/** phone → recorrido campo por campo en curso (canalWalk.ts). */
const formWalks = new Map<string, FormWalk>();

/** phone → JWT del último turno, para vaciar el registro crudo sin turno. */
const jwtDe = new Map<string, string>();

/** Un mensaje a la vez por número; ver `colaPorChat`. */
const enCola = colaPorChat<string>('whatsapp');

let cerebro: InvokeChat | null = null;

/**
 * Registro crudo del canal (canalRaw.ts). Sin turno que los lleve, los eventos
 * se mandan solos a la sesión del número; si todavía no hay sesión, esperan.
 */
const crudo = crearRegistroCrudo('whatsapp', async (from, eventos) => {
  const sessionId = phoneSessions.get(from);
  const jwt = jwtDe.get(from);
  if (!cerebro || !sessionId || !jwt) return false;
  const { status, body } = await cerebro({
    headers: { authorization: `Bearer ${jwt}` },
    body: { session_id: sessionId, canal_raw: eventos },
  });
  return status === 200 && body?.ok !== false;
});

/**
 * Eco del hilo del paciente activo (canalEco.ts). Vale mientras el paciente
 * siga vigente en el teléfono: dentro del rato de inactividad, sin la pregunta
 * «¿Sigues con X?» pendiente, y dentro de la ventana de Meta.
 */
const eco = crearEco<string>('whatsapp', {
  sesionDe: from => phoneSessions.get(from),
  jwtDe: from => jwtDe.get(from),
  renovarJwt: async from => {
    const auth = await resolveUserAuth(from, undefined, true);
    if (!auth.ok || auth.pendiente) return null;
    jwtDe.set(from, auth.jwt);
    return auth.jwt;
  },
  vigente: from => !enEspera.has(from)
    && Date.now() - (ultimoEntrante.get(from) || 0) <= Math.min(VENTANA_META_MS, inactividadMs()),
  enviar: (from, texto) => sendWhatsappText(from, texto, 'eco'),
  enCola: (from, tarea) => enCola(from, tarea),
});

/** Render a BotForm as plain text so a WhatsApp user can still answer it. */
function renderForm(form: BotForm): string {
  const lines: string[] = ['', `📋 *${form.title}*`];
  for (const f of form.fields as BotFormField[]) {
    if (f.type === 'heading') { lines.push(`\n*${f.label}*`); continue; }
    const req = f.required ? ' (requerido)' : '';
    let opts = '';
    if (Array.isArray(f.options) && f.options.length) {
      const labels = f.options.map(o => (typeof o === 'string' ? o : o.label));
      opts = ` [${labels.join(' / ')}]`;
    }
    lines.push(`• ${f.label}${req}${opts}`);
  }
  return lines.join('\n');
}

/**
 * Texto de una respuesta del cerebro: primera línea el `status_header`
 * (paciente activo o estado del chat), después el texto y el formulario si no
 * se recorre. Las opciones NO van acá: salen como botones o lista numerada.
 */
function composeReply(body: any): string {
  const header = String(body?.status_header || '').trim();
  let text = String(body?.text || '').trim();
  // El formulario de búsqueda es un solo cuadro de texto: en un chat ya es el
  // propio chat, y pintarlo solo mete ruido debajo de los resultados.
  if (body?.form && body.form.id !== 'patient_search') text += '\n' + renderForm(body.form);
  text = text || '…';
  return header ? `${header}\n${text}` : text;
}

// ── Opciones: botones de respuesta o lista numerada ─────────────────────────
//
// WhatsApp admite hasta 3 botones de respuesta con título de 20 caracteres.
// Lo que cabe sale como botones; lo que no, como lista numerada que se
// contesta con el número. En los dos casos también vale escribir la etiqueta.

/** Una opción lleva un `send` (texto para el cerebro) o un `value` (respuesta de un campo). */
interface Opcion { label: string; send?: string; value?: any; esValor?: boolean; accion?: 'seguir' | 'cambiar' | 'saltar' | 'reintentar'; }

/** Lo último que se le ofreció a un número: contra esto se resuelve su respuesta. */
interface Pregunta { serie: number; opciones: Opcion[]; numerada: boolean; }
const preguntas = new Map<string, Pregunta>();
let seriePregunta = 0;

const BOTON_OPCION = 'op:';
/** Cuánto vale un botón cuya pregunta ya no está en memoria. */
const BOTON_VIGENTE_MS = 15 * 60 * 1000;
const MAX_BOTONES = 3;
const MAX_TITULO = 20;
/** Una lista admite 10 filas, con título de 24 caracteres y descripción de 72. */
const MAX_FILAS = 10;
const MAX_TITULO_FILA = 24;

/** Para comparar lo que la persona escribió con una etiqueta: sin tildes, emojis ni signos. */
function llano(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Recorta una etiqueta al largo que admite Meta. */
function recortar(t: string, max: number): string {
  const limpio = t.trim();
  return limpio.length <= max ? limpio : limpio.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Manda un texto con sus opciones. `elegibles` son las respuestas posibles;
 * `acciones`, salidas laterales (Omitir, Nuevo paciente). Hasta 3 salen como
 * botones, hasta 10 como lista desplegable, y si Meta rechaza el mensaje —o son
 * más— como lista numerada: la persona nunca se queda sin cómo contestar.
 */
async function sendOpciones(to: string, text: string, elegibles: Opcion[], acciones: Opcion[] = []): Promise<void> {
  // La misma salida puede venir dos veces (el cerebro la ofrece y el formulario
  // también): Meta rechaza el mensaje entero por un título repetido.
  const yaEsta = new Set(elegibles.map(o => o.send ?? `v:${llano(o.label)}`));
  acciones = acciones.filter(a => !yaEsta.has(a.send ?? `v:${llano(a.label)}`));
  const todas = [...elegibles, ...acciones];
  if (!todas.length) { preguntas.delete(to); await sendWhatsappText(to, text); return; }
  const serie = ++seriePregunta;
  // El id lleva también la hora y el `send`: tras un reinicio del bot la
  // pregunta ya no está en memoria, y un botón recién enviado tiene que seguir
  // sirviendo (ver `resolverOpcion`). Meta admite hasta 256 caracteres.
  const ahora = Date.now().toString(36);
  const ids = todas.map((o, i) => `${BOTON_OPCION}${serie}:${i}:${ahora}:${o.send ?? ''}`.slice(0, 256));
  const sinRepetir = (max: number) => new Set(todas.map(o => llano(recortar(o.label, max)))).size === todas.length;

  if (todas.length <= MAX_BOTONES && sinRepetir(MAX_TITULO)) {
    preguntas.set(to, { serie, opciones: todas, numerada: false });
    if (await sendWhatsappInteractivo(to, text, {
      type: 'button',
      action: { buttons: todas.map((o, i) => ({ type: 'reply', reply: { id: ids[i], title: recortar(o.label, MAX_TITULO) } })) },
    }, todas.map(o => o.label))) return;
  } else if (todas.length <= MAX_FILAS) {
    preguntas.set(to, { serie, opciones: todas, numerada: false });
    if (await sendWhatsappInteractivo(to, text, {
      type: 'list',
      action: {
        button: 'Ver opciones',
        sections: [{ title: 'Opciones', rows: todas.map((o, i) => ({
          id: ids[i], title: recortar(o.label, MAX_TITULO_FILA),
          // El título se recorta; la etiqueta completa va en la descripción.
          ...(o.label.trim().length > MAX_TITULO_FILA ? { description: recortar(o.label, 72) } : {}),
        })) }],
      },
    }, todas.map(o => o.label))) return;
  }
  const lineas = elegibles.map((o, i) => `${i + 1}. ${o.label}`);
  const salidas = acciones.map(a => `_${a.label}: escribe «${a.send}»_`);
  preguntas.set(to, { serie, opciones: todas, numerada: elegibles.length > 0 });
  await sendWhatsappText(to, [text, lineas.join('\n'), salidas.join('\n')].filter(Boolean).join('\n\n'));
}

/**
 * La opción que eligió la persona, por botón, por número o por etiqueta.
 * `vencida`: tocó un botón de una pregunta anterior.
 */
function resolverOpcion(from: string, msg: any): { opcion?: Opcion; vencida?: boolean } {
  const p = preguntas.get(from);
  const id = msg?.interactive?.button_reply?.id ?? msg?.interactive?.list_reply?.id;
  if (typeof id === 'string' && id.startsWith(BOTON_OPCION)) {
    const [serieTxt, iTxt, hora, ...resto] = id.slice(BOTON_OPCION.length).split(':');
    const opcion = p && p.serie === parseInt(serieTxt, 10) ? p.opciones[parseInt(iTxt, 10)] : undefined;
    if (opcion) return { opcion };
    // Sin ninguna pregunta en memoria para este número (el bot se reinició):
    // el botón vale por lo que lleva escrito, si es reciente. Con otra pregunta
    // ya hecha, en cambio, es un botón viejo y no se obedece.
    const send = resto.join(':');
    const edad = Date.now() - parseInt(hora || '', 36);
    if (!p && send && edad >= 0 && edad < BOTON_VIGENTE_MS) return { opcion: { label: send, send } };
    return { vencida: true };
  }
  const texto = typeof msg?.text?.body === 'string' ? msg.text.body.trim() : '';
  if (!p || !texto) return {};
  // El número solo vale si la lista salió numerada: con botones a la vista, un
  // «2» es una respuesta («hace 2 días»), no la segunda opción.
  if (p.numerada && /^\d{1,2}$/.test(texto)) {
    const opcion = p.opciones[parseInt(texto, 10) - 1];
    if (opcion) return { opcion };
  }
  const opcion = p.opciones.find(o => llano(o.label) === llano(texto));
  return opcion ? { opcion } : {};
}

/** Send a text message back through the WhatsApp Cloud API (best-effort). */
async function sendWhatsappText(to: string, text: string, tipo = 'text'): Promise<void> {
  crudo.anotar(to, { dir: 'out', tipo, texto: text });
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    console.log(`[whatsapp] (dry-run, no WHATSAPP_TOKEN/PHONE_ID) → ${to}: ${text}`);
    return;
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text.slice(0, 4096) },
      }),
    });
    if (!r.ok) console.error(`[whatsapp] send failed ${r.status}: ${await r.text()}`);
  } catch (e: any) {
    console.error('[whatsapp] send error:', e?.message || e);
  }
}

/**
 * Mensaje interactivo: botones de respuesta o lista desplegable. `false` si no
 * salió (Meta lo rechazó o no hay credenciales): quien llama cae a texto.
 */
async function sendWhatsappInteractivo(
  to: string, text: string, interactivo: { type: 'button' | 'list'; action: unknown }, etiquetas: string[],
): Promise<boolean> {
  const tok     = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!tok || !phoneId) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: { ...interactivo, body: { text: text.slice(0, 1024) } },
      }),
    });
    if (!r.ok) { console.error(`[whatsapp] ${interactivo.type} failed ${r.status}: ${await r.text()}`); return false; }
    crudo.anotar(to, { dir: 'out', tipo: interactivo.type === 'list' ? 'lista' : 'botones', texto: text, crudo: etiquetas });
    return true;
  } catch (e: any) {
    console.error(`[whatsapp] ${interactivo.type} error:`, e?.message || e);
    return false;
  }
}

// ── Imágenes entrantes ──────────────────────────────────────────────────────

/** La imagen que trae un mensaje: una foto, o un documento que es una imagen. */
interface ImagenEntrante { mediaId: string; mime: string; nombre: string; }

function imagenDe(msg: any): ImagenEntrante | null {
  const foto = msg?.type === 'image' ? msg.image : null;
  const doc = msg?.type === 'document' && String(msg.document?.mime_type || '').startsWith('image/')
    ? msg.document : null;
  const m = foto || doc;
  if (!m?.id) return null;
  const mime = String(m.mime_type || 'image/jpeg').split(';')[0];
  return {
    mediaId: String(m.id), mime,
    nombre: nombreDeAdjunto(doc?.filename || `whatsapp_${String(m.id).slice(-12)}.${extensionDe(mime)}`),
  };
}

/**
 * Baja un archivo de la Cloud API: primero se pide su URL (vale unos minutos)
 * y después el contenido, las dos veces con el token del canal.
 */
async function downloadWhatsappMedia(mediaId: string): Promise<Buffer | null> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) { console.error('[whatsapp] sin WHATSAPP_TOKEN no se puede bajar la imagen'); return null; }
  try {
    const auth = { Authorization: `Bearer ${token}` };
    const info: any = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, { headers: auth })
      .then(r => r.json());
    if (!info?.url) { console.error('[whatsapp] media sin url', JSON.stringify(info)); return null; }
    const r = await fetch(info.url, { headers: auth });
    if (!r.ok) { console.error(`[whatsapp] media download ${r.status}`); return null; }
    return Buffer.from(await r.arrayBuffer());
  } catch (e: any) {
    console.error('[whatsapp] downloadWhatsappMedia error:', e?.message || e);
    return null;
  }
}

/** Baja la imagen y la sube como adjunto a nombre de quien la mandó. Devuelve su id. */
async function guardarImagen(jwt: string, img: ImagenEntrante): Promise<string | null> {
  const buffer = await downloadWhatsappMedia(img.mediaId);
  if (!buffer) return null;
  return subirAdjunto('whatsapp', jwt, buffer, img.nombre, img.mime);
}

/** Prefijo del id del botón «Cancelar» del aviso; lo que sigue es el token de la ventana. */
const BOTON_CANCELAR = 'cancelar:';

/**
 * El aviso de «pensando» con su botón «Cancelar» (mensaje interactivo). WhatsApp
 * no deja editar ni retirar el botón después: un toque tardío recibe TXT_TARDE.
 */
async function sendWhatsappAviso(to: string, text: string, token: string): Promise<void> {
  crudo.anotar(to, { dir: 'out', tipo: 'aviso', texto: text });
  const tok     = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!tok || !phoneId) {
    console.log(`[whatsapp] (dry-run, no WHATSAPP_TOKEN/PHONE_ID) → ${to}: ${text} [${TXT_CANCELAR}]`);
    return;
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: { buttons: [{ type: 'reply', reply: { id: `${BOTON_CANCELAR}${token}`, title: TXT_CANCELAR } }] },
        },
      }),
    });
    if (!r.ok) console.error(`[whatsapp] aviso failed ${r.status}: ${await r.text()}`);
  } catch (e: any) {
    console.error('[whatsapp] aviso error:', e?.message || e);
  }
}

/**
 * Indicador de «escribiendo…» mientras el cerebro arma la respuesta. Meta lo
 * ata a marcar como leído el mensaje entrante, dura hasta 25 s o hasta la
 * respuesta, y no admite texto propio (por eso existe `avisoContinuando`).
 */
async function sendWhatsappTyping(messageId: string | undefined): Promise<void> {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId || !messageId) return;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
    });
    if (!r.ok) console.error(`[whatsapp] typing failed ${r.status}: ${await r.text()}`);
  } catch (e: any) {
    console.error('[whatsapp] typing error:', e?.message || e);
  }
}

/**
 * Números sin acceso a los que ya se les contestó una vez en este proceso. El
 * número es público: cada respuesta a un desconocido es un mensaje saliente
 * más, así que se contesta una sola vez y después se calla. Para la identidad
 * dada de alta vale `creada`, que viene de la base y sobrevive reinicios; este
 * conjunto cubre el caso sin alta (`unregistered`) y se vacía al reiniciar.
 */
const yaAvisados = new Set<string>();

/**
 * Último aviso de «no pude verificar» por número. Ese error suele ser de
 * configuración (org o cuenta de servicio) y se repite en cada mensaje: sin
 * esto, cada mensaje entrante recibe una respuesta. Uno por hora basta.
 */
const avisosDeError = new Map<string, number>();
const AVISO_ERROR_CADA_MS = 60 * 60 * 1000;

/**
 * El único aviso que recibe quien todavía no tiene acceso, sea cual sea el
 * motivo (sin registro, pendiente, no se pudo verificar): habla del registro
 * en curso, no de un rechazo.
 */
function avisoRegistro(nombre?: string): string {
  const n = nombre?.trim().split(/\s+/)[0];
  return `👋 Hola${n ? `, ${n}` : ''}. Recibimos tu mensaje.\n\n` +
    `Estamos procesando tu registro en CEPI Telemedicina; te contestaremos cuando esté listo.`;
}

/** Números a los que ya se les avisó que su registro está listo (en este proceso). */
const yaActivados = new Set<string>();

/**
 * «Tu registro está listo»: lo pide TodoERP cuando un admin aprueba o vincula
 * una identidad pendiente (EXTERNAL_IDENTITY_WEBHOOK_URL). El aviso no trae
 * secreto, así que no se le cree: se vuelve a resolver el número y solo se
 * escribe si de verdad ya tiene acceso. Una vez por número y proceso.
 *
 * Meta solo deja mandar texto libre dentro de las 24 h desde el último mensaje
 * de la persona; fuera de esa ventana el envío falla (131047) y queda en el log.
 */
export async function avisarRegistroListo(from: string): Promise<'enviado' | 'omitido'> {
  if (yaActivados.has(from)) return 'omitido';
  const auth = await resolveUserAuth(from, undefined, true);
  if (!auth.ok || auth.pendiente) return 'omitido';
  yaActivados.add(from);
  yaAvisados.delete(from);
  avisosDeError.delete(from);
  const n = auth.nombre?.trim().split(/\s+/)[0];
  await sendWhatsappText(from,
    `✅ Hola${n ? `, ${n}` : ''}. Tu registro en CEPI Telemedicina está listo: ` +
    `ya puedes escribir por este chat.`);
  return 'enviado';
}

/** El aviso interno solo se acepta desde la propia máquina y sin pasar por nginx. */
function esLocal(req: Request): boolean {
  const ip = req.socket.remoteAddress || '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return local && !req.get('x-forwarded-for');
}

/**
 * Toque en «Cancelar» del aviso: cierra la ventana de gracia de ese turno. No
 * pasa por la identidad: la ventana solo la cierra el número que la abrió.
 */
async function handleCancelar(from: string, boton: string, msg: any): Promise<void> {
  crudo.anotar(from, { dir: 'in', tipo: 'interactive', texto: TXT_CANCELAR, crudo: msg });
  const ok = cancelarGracia(boton.slice(BOTON_CANCELAR.length), from);
  await sendWhatsappText(from, ok ? TXT_CANCELADO : TXT_TARDE);
}

/** Process one inbound message object from the webhook payload. */
async function handleInbound(invokeChat: InvokeChat, msg: any, nombre?: string): Promise<void> {
  const from = msg?.from;
  if (!from) return;

  // Identity gate: the turn runs AS the user linked to this phone, or not at all.
  // Va antes que el filtro de texto: un desconocido que manda un audio tampoco
  // debe recibir respuesta más de una vez.
  const auth = await resolveUserAuth(from, nombre);
  if (!auth.ok) {
    if (auth.reason === 'error') {
      const ultimo = avisosDeError.get(from) || 0;
      if (Date.now() - ultimo < AVISO_ERROR_CADA_MS) {
        console.log(`[whatsapp] ${from} sin verificar, ya avisado en la última hora: sin respuesta`);
        return;
      }
      avisosDeError.set(from, Date.now());
      await sendWhatsappText(from, avisoRegistro(nombre));
      return;
    }
    if (yaAvisados.has(from)) { console.log(`[whatsapp] ${from} sin registro, ya avisado: sin respuesta`); return; }
    yaAvisados.add(from);
    await sendWhatsappText(from, avisoRegistro(nombre));
    return;
  }
  // Identidad pendiente de aprobación: una sola respuesta, la del alta. Nunca
  // llega al cerebro: cada turno es un mensaje saliente y una llamada al LLM.
  if (auth.pendiente) {
    if (!auth.creada) { console.log(`[whatsapp] ${from} pendiente de aprobación: sin respuesta`); return; }
    await sendWhatsappText(from, avisoRegistro(nombre));
    return;
  }

  crudo.activar(from);
  jwtDe.set(from, auth.jwt);
  const previa = ultimoEntrante.get(from);
  ultimoEntrante.set(from, Date.now());
  armarPausa(from);
  const img = imagenDe(msg);
  // El texto de una foto viaja en su `caption`.
  const texto = String(msg?.text?.body ?? msg?.image?.caption ?? msg?.document?.caption ?? '').trim();
  crudo.anotar(from, {
    dir: 'in', tipo: String(msg?.type || 'text'),
    texto: texto || String(msg?.interactive?.button_reply?.title || msg?.interactive?.list_reply?.title || ''), crudo: msg,
  });
  const ctx: Turno = { invokeChat, from, jwt: auth.jwt, msgId: msg?.id };

  const { opcion, vencida } = resolverOpcion(from, msg);
  if (vencida) {
    await sendWhatsappText(from, 'Esa opción ya no está vigente.');
    if (formWalks.has(from)) await askWalkField(ctx);
    return;
  }
  // Texto, toques en botones e imágenes; audio y video todavía no.
  if (!opcion && !texto && !img) {
    await sendWhatsappText(from, 'Por ahora proceso texto e imágenes. Envíame un mensaje o una foto.');
    if (formWalks.has(from)) await askWalkField(ctx);
    return;
  }

  const entrada: Entrada = { texto, img, opcion };
  if (await preguntarSiSigue(ctx, entrada, previa)) return;
  await procesar(ctx, entrada);
}

/** Nombre del paciente activo de ese número, para nombrarlo en una pregunta. */
function nombreDelActivo(from: string): string {
  const previo = lastPatient.get(from);
  return pacienteActivo.get(from)
    || (previo && previo.id === eco.pacienteDe(from) ? previo.name : '')
    || 'el mismo paciente';
}

/** Las dos salidas de «¿Sigues con X?». */
const OPCIONES_DE_PAUSA: Opcion[] = [
  { label: 'Sí, continuar', accion: 'seguir' },
  { label: 'Cambiar paciente', accion: 'cambiar' },
];

/**
 * (Re)arma el aviso de pausa. Cuando pasa el rato de inactividad con un
 * paciente activo, el canal lo DICE en ese momento, sin esperar al mensaje
 * siguiente: si no, el médico contesta una pregunta de la ficha y recién ahí
 * se entera de que la consulta estaba en pausa. Deja la pregunta hecha.
 */
function armarPausa(from: string, ms = inactividadMs()): void {
  const previo = relojesDePausa.get(from);
  if (previo) clearTimeout(previo);
  const t = setTimeout(() => {
    relojesDePausa.delete(from);
    void enCola(from, async () => {
      // Pudo escribir, cambiar de paciente o quedar ya preguntado mientras esperaba la cola.
      // (Cada mensaje entrante rearma este reloj: si llegó a sonar, es que no hubo otro.)
      if (!phoneSessions.has(from) || !eco.pacienteDe(from) || enEspera.has(from)) return;
      const nombre = nombreDelActivo(from);
      enEspera.set(from, { nombre });
      await sendOpciones(from,
        `⏸️ Pausé la consulta de *${nombre}* por inactividad.\n¿Sigues con *${nombre}*?`, OPCIONES_DE_PAUSA);
      persistir();
    });
  }, ms);
  if (typeof (t as any).unref === 'function') (t as any).unref();
  relojesDePausa.set(from, t);
}

/** Un mensaje entrante ya leído: su texto, su imagen y la opción que eligió. */
interface Entrada { texto: string; img: ImagenEntrante | null; opcion?: Opcion; }

/** La sesión más reciente de ese usuario por este canal, si tiene paciente activo. */
async function ultimaSesionDelCanal(jwt: string): Promise<{ id: string; patientId: string; nombre: string } | null> {
  const base = process.env.CEPI_BOT_URL || `http://localhost:${process.env.PORT || '3002'}`;
  try {
    const r = await fetch(`${base}/api/bot/sessions`, { headers: { authorization: `Bearer ${jwt}` } });
    if (!r.ok) return null;
    const data: any = await r.json().catch(() => ({}));
    // Vienen de la más reciente a la más vieja. Solo cuenta la última del canal:
    // si esa ya no tiene paciente, no hay nada que retomar.
    const s = (Array.isArray(data?.sessions) ? data.sessions : []).find((x: any) => x?.canal === 'whatsapp');
    if (!s || s.estado !== 'abierta' || !s.active_patient_id) return null;
    if (Date.now() - new Date(s.updated_at || s.created_at).getTime() > VENTANA_META_MS) return null;
    return { id: s.id, patientId: s.active_patient_id, nombre: s.patient_name || 'el mismo paciente' };
  } catch { return null; }
}

/**
 * Retoma una sesión recuperada de la base tras un reinicio: si el bot había
 * dejado algo preguntado —una sección de la ficha abierta, una imagen sin
 * clasificar, una confirmación— lo vuelve a mostrar. El mensaje retenido NO se
 * procesa en ese caso: se escribió sin la pregunta a la vista, y mandarlo al
 * agente como texto libre lo hace improvisar (pasó: «¿Qué muestra la imagen
 * que adjuntaste?»). Devuelve `false` si no había nada pendiente.
 */
async function retomar(ctx: Turno, entrada: Entrada | undefined): Promise<boolean> {
  const { from } = ctx;
  const base = process.env.CEPI_BOT_URL || `http://localhost:${process.env.PORT || '3002'}`;
  let s: any = null;
  try {
    const r = await fetch(`${base}/api/bot/session/${phoneSessions.get(from)}`, {
      headers: { authorization: `Bearer ${ctx.jwt}` },
    });
    if (r.ok) s = await r.json().catch(() => null);
  } catch { s = null; }
  if (!s?.ok) return false;
  const seccion = isWalkableForm(s.form);
  if (!seccion && !s.pendiente && !s.pending_action) return false;
  // Una foto retenida no es una respuesta fuera de contexto: se procesa. (Solo
  // cede ante una pregunta abierta, que hay que contestar antes.)
  if (entrada?.img && !s.pendiente && !s.pending_action) return false;

  if (entrada && (entrada.texto || entrada.img)) {
    await sendWhatsappText(from, 'Retomamos donde quedó. Tu último mensaje no se procesó: responde a lo que sigue.');
  }
  await deliver(ctx, {
    session_id: s.session_id,
    active_patient_id: s.active_patient_id,
    status_header: s.status_header,
    text: s.pendiente?.text
      || (s.pending_action ? `${s.pending_action.summary}\n\n¿Confirmas?` : 'Seguimos con la ficha:'),
    // Una pregunta abierta va antes que la sección: se contesta y después sigue la ficha.
    form: s.pendiente || s.pending_action ? null : s.form,
    quick_replies: s.pendiente?.quick_replies || [],
    pending_action: s.pending_action || null,
  });
  return true;
}

/**
 * «Paciente activo» dura minutos (`inactividadMs`). Si la persona vuelve
 * después de ese rato —o el bot se reinició y perdió lo que tenía en memoria—
 * no se da por hecho que sigue con el mismo: el mensaje se retiene y se le
 * pregunta. «Sí» lo procesa con ese paciente; «Cambiar» lo descarta y muestra
 * el menú. Devuelve `true` si el mensaje quedó atendido acá.
 */
async function preguntarSiSigue(ctx: Turno, entrada: Entrada, previa: number | undefined): Promise<boolean> {
  const { from } = ctx;
  const { texto, opcion } = entrada;
  const preguntar = (nombre: string) => sendOpciones(from, `¿Sigues con *${nombre}*?`, OPCIONES_DE_PAUSA);

  // Quien llega cambiando de paciente ya contestó la pregunta, esté hecha o no.
  const cambia = CAMBIA_PACIENTE.test(texto) || CAMBIA_PACIENTE.test(opcion?.send || '')
    || /^\/?\s*men[uú]\s*$/i.test(texto);
  if (cambia) { enEspera.delete(from); buscados.add(from); return false; }

  const pend = enEspera.get(from);
  if (pend) {
    if (opcion?.accion === 'seguir' || /^s[ií]$/i.test(texto)) {
      enEspera.delete(from);
      if (pend.adoptar) {
        phoneSessions.set(from, pend.adoptar.id);
        pacienteActivo.set(from, pend.nombre);
        lastPatient.set(from, { id: pend.adoptar.patientId, name: pend.nombre });
        eco.fijar(from, pend.adoptar.patientId);
        // La sesión se recuperó de la base: lo que el bot tenía preguntado ya
        // no está en memoria. Se vuelve a mostrar antes que nada.
        if (await retomar(ctx, pend.entrada)) return true;
      }
      if (pend.entrada) { await procesar(ctx, pend.entrada); return true; }
      // Contestó al aviso de pausa sin haber escrito nada más: se retoma donde
      // estaba, repitiendo la pregunta de la ficha que había quedado abierta.
      await sendWhatsappText(from, `▶️ Continuamos con *${pend.nombre}*.`);
      if (formWalks.has(from)) await askWalkField(ctx);
      return true;
    }
    if (opcion?.accion === 'cambiar' || /^no$/i.test(texto)) {
      const w = formWalks.get(from);
      if (w) await guardarParcial(ctx, w);
      if (pend.entrada) await sendWhatsappText(from, 'No procesé tu mensaje anterior.');
      await sendMenu(from);
      return true;
    }
    // Otra cosa: pasa a ser el mensaje retenido y se vuelve a preguntar.
    pend.entrada = entrada;
    await preguntar(pend.nombre);
    return true;
  }

  if (phoneSessions.has(from)) {
    const inactivo = previa !== undefined && Date.now() - previa > inactividadMs();
    if (!inactivo || !eco.pacienteDe(from)) return false;
    const nombre = nombreDelActivo(from);
    enEspera.set(from, { entrada, nombre });
    await preguntar(nombre);
    return true;
  }

  // Sin nada en memoria (primer mensaje tras un reinicio): se busca en la base.
  if (buscados.has(from)) return false;
  buscados.add(from);
  const anterior = await ultimaSesionDelCanal(ctx.jwt);
  if (!anterior) return false;
  enEspera.set(from, { entrada, nombre: anterior.nombre, adoptar: { id: anterior.id, patientId: anterior.patientId } });
  await preguntar(anterior.nombre);
  return true;
}

/** Atiende un mensaje entrante ya validado: recorrido en curso, menú, imagen o turno. */
async function procesar(ctx: Turno, { texto, img, opcion }: Entrada): Promise<void> {
  const { from } = ctx;

  // ── En medio de un recorrido: la respuesta es del campo, no del cerebro ──
  let walk = formWalks.get(from);
  if (walk && img) {
    const f = walk.form.fields[walk.idx];
    if (f?.type === 'image_upload') { await recibirEnCampo(ctx, walk, f, img); return; }
    if (walk.form.id.startsWith('ficha_grp_')) {
      // Foto en medio de otra sección de la ficha: sale del recorrido (guardando
      // lo contestado) y la recibe el cerebro, que pregunta si es de la lesión
      // o un consentimiento.
      await guardarParcial(ctx, walk);
      walk = undefined;
    } else {
      // En el alta todavía no hay paciente: la imagen quedaría huérfana.
      await sendWhatsappText(from,
        'Estoy registrando los datos del paciente: todavía no puedo recibir imágenes. ' +
        'Responde el campo que te pedí (o escribe «cancelar»).');
      await askWalkField(ctx);
      return;
    }
  }
  if (walk) {
    if (opcion) {
      if (opcion.esValor) { await applyWalkAnswer(ctx, opcion.value); return; }
      if (opcion.accion === 'saltar') { walk.idx++; await askWalkField(ctx); return; }
      if (opcion.accion === 'reintentar') { await askWalkField(ctx); return; }
      if (/^omitir/i.test(opcion.send || '')) { await omitirSeccion(ctx, walk); return; }
      await guardarParcial(ctx, walk);        // otra acción sale del recorrido
      await routeTurn(ctx, { message: opcion.send || '' }, opcion.send || '');
      return;
    }
    if (/^\/?\s*(cancelar|salir|men[uú])\s*$/i.test(texto)) {
      await guardarParcial(ctx, walk);
      await sendMenu(from);
      return;
    }
    // «saltar» / «omitir» dejan sin contestar ESTE campo; «omitir restante»
    // termina la sección. Ninguno es el valor de un campo.
    if (walk.form.submit_mode === 'structured' && /^\/?\s*(saltar|omitir)\s*$/i.test(texto)) { walk.idx++; await askWalkField(ctx); return; }
    if (/^\/?\s*omitir\s+(restante|resto|ficha|secci[oó]n)\s*$/i.test(texto)) { await omitirSeccion(ctx, walk); return; }
    // Tampoco lo son los comandos que cambian o sueltan al paciente: tomarlos
    // como respuesta dejaría al médico atrapado en la sección («salir paciente»
    // quedaba guardado como dirección).
    if (/^\//.test(texto) || CAMBIA_PACIENTE.test(texto)) {
      await guardarParcial(ctx, walk);
      await routeTurn(ctx, { message: texto }, texto);
      return;
    }
    // Pregunta cerrada contestada con otra cosa: no se guarda un valor que el
    // campo no admite; se vuelve a preguntar.
    const f = walk.form.fields[walk.idx];
    if (f && (f.type === 'radio' || f.type === 'checkbox')) {
      await sendWhatsappText(from, 'Elige una de las opciones.');
      await askWalkField(ctx);
      return;
    }
    // Un campo de imágenes no se contesta con texto: guardaría basura como id.
    if (f?.type === 'image_upload') {
      await sendWhatsappText(from, 'Aquí va una foto, no texto.');
      await askWalkField(ctx);
      return;
    }
    // Campo con tipo (fecha, número): validador determinista, después IA, y si
    // ninguno lo entiende se dice y se vuelve a preguntar. Nunca se guarda un
    // valor que la columna va a rechazar.
    const tipo = f ? tipoEsperado(f) : null;
    if (f && tipo) {
      const v = await validarRespuesta(f, texto);
      if (!v.ok) {
        await sendWhatsappText(from, `No entendí «${texto}» como ${ayudaDeTipo(tipo)}.`);
        await askWalkField(ctx);
        return;
      }
      // Lo que interpretó la IA no se guarda sin confirmación: se equivoca con aplomo.
      if (v.porIA) {
        await sendOpciones(from, `Entendí *${legible(tipo, v.value)}*. ¿Es correcto?`, [
          { label: 'Sí', value: v.value, esValor: true },
          { label: 'No', accion: 'reintentar' },
        ]);
        return;
      }
      await applyWalkAnswer(ctx, v.value);
      return;
    }
    await applyWalkAnswer(ctx, texto);
    return;
  }

  if (/^\/?\s*men[uú]\s*$/i.test(texto)) { await sendMenu(from); return; }

  // Imagen suelta: se sube y va al cerebro con el marcador que usa la web.
  if (img) {
    const id = await guardarImagen(ctx.jwt, img);
    if (!id) { await sendWhatsappText(from, 'No pude procesar la imagen. Prueba de nuevo.'); return; }
    const mensaje = [texto, marcadorAdjunto(img.nombre, id)].filter(Boolean).join('\n');
    await routeTurn(ctx, { message: mensaje }, texto);
    return;
  }

  // Un «Sí, continuar» sin pregunta pendiente no es un mensaje para el cerebro.
  if (opcion?.accion) { await sendWhatsappText(from, 'Esa opción ya no está vigente.'); return; }

  const send = opcion?.send ?? texto;
  await routeTurn(ctx, { message: send }, send);
}

/** Ids de adjunto ya recibidos en un campo de imágenes (su valor es un CSV). */
function idsDelCampo(w: FormWalk, key: string | undefined): string[] {
  const v = key ? w.answers[key] : '';
  return typeof v === 'string' && v ? v.split(',') : [];
}

/**
 * Una foto en un campo de imágenes de la ficha. Se sube y su id se suma al
 * valor del campo; el envío de la sección crea los registros como lo hace la
 * web (calidad y rostro en §4.7, consentimiento en §8). Con `multiple` el campo
 * sigue abierto hasta «Listo»; si no, la primera foto lo cierra.
 */
async function recibirEnCampo(ctx: Turno, w: FormWalk, f: BotFormField, img: ImagenEntrante): Promise<void> {
  const id = await guardarImagen(ctx.jwt, img);
  if (!id) {
    await sendWhatsappText(ctx.from, 'No pude procesar la imagen. Envíala de nuevo.');
    await askWalkField(ctx);
    return;
  }
  const ids = [...idsDelCampo(w, f.key), id];
  if (f.key) w.answers[f.key] = ids.join(',');
  if (!(f as any).multiple) { w.idx++; }
  await askWalkField(ctx);
}

/** Pedidos de buscar o crear un paciente: con uno activo, implican dejarlo. */
const ENTRA_A_OTRO = /^\/?\s*(nuevo|nuevo\s+paciente|crear\s+paciente|paciente|buscar(\s+paciente)?|atenci[oó]n)\s*$/i;

/** «salir paciente» y sus variantes. */
const SUELTA_PACIENTE = /^\/?\s*(salir|cerrar|olvidar)\s+paciente\s*$/i;

// ── Estado que sobrevive a un reinicio ──────────────────────────────────────

const estado = crearEstado(() => `whatsapp-${process.env.WHATSAPP_WEBHOOK_PORT || '9997'}`);

/** Foto de lo que el canal sabe de cada número (sin credenciales). */
function fotoDelEstado(): unknown {
  return {
    v: 1,
    phoneSessions: [...phoneSessions], pacienteActivo: [...pacienteActivo], lastPatient: [...lastPatient],
    ultimoEntrante: [...ultimoEntrante], formWalks: [...formWalks], preguntas: [...preguntas],
    enEspera: [...enEspera], seriePregunta, eco: eco.exportar(),
  };
}

/** Se guarda tras cada cosa que cambia el estado; las ráfagas se agrupan. */
function persistir(): void { estado.guardar(fotoDelEstado); }

/**
 * Al arrancar: retoma donde quedó cada número. Un deploy deja de notarse: la
 * sesión, el paciente activo, la sección a medias y sus respuestas siguen ahí.
 */
function restaurarEstado(): void {
  const e = estado.cargar();
  if (!e || e.v !== 1) return;
  const llenar = <V>(m: Map<string, V>, datos: any) => { for (const [k, v] of datos || []) m.set(String(k), v); };
  llenar(phoneSessions, e.phoneSessions); llenar(pacienteActivo, e.pacienteActivo); llenar(lastPatient, e.lastPatient);
  llenar(ultimoEntrante, e.ultimoEntrante); llenar(formWalks, e.formWalks); llenar(preguntas, e.preguntas);
  llenar(enEspera, e.enEspera);
  seriePregunta = Math.max(seriePregunta, Number(e.seriePregunta) || 0);
  eco.importar(e.eco);
  // El aviso de pausa de quien todavía está dentro del rato de inactividad. A
  // quien ya se le pasó no se le escribe ahora: se le pregunta cuando vuelva.
  for (const [from, ultimo] of ultimoEntrante) {
    const falta = inactividadMs() - (Date.now() - ultimo);
    if (falta > 0 && eco.pacienteDe(from)) armarPausa(from, falta);
  }
  console.log(`[whatsapp] estado restaurado: ${phoneSessions.size} sesión(es), ${formWalks.size} recorrido(s)`);
}

/** Comandos que sacan de un recorrido aunque no lleven barra. */
const CAMBIA_PACIENTE = /^\s*((salir|cerrar|olvidar)\s+paciente|activar\s+paciente\s+[0-9a-f-]{36}|nuevo\s+paciente|buscar\s+paciente)\s*$/i;

/** Lo que hace falta para correr un turno de ese número. */
interface Turno { invokeChat: InvokeChat; from: string; jwt: string; msgId?: string; }

/**
 * Menú de inicio: nuevo paciente, buscar y, si lo hubo, el paciente anterior.
 * Deja al número sin sesión ni recorrido: el turno siguiente empieza limpio.
 */
async function sendMenu(from: string): Promise<void> {
  phoneSessions.delete(from);
  pacienteActivo.delete(from);
  eco.soltar(from);
  enEspera.delete(from);
  formWalks.delete(from);
  const opciones: Opcion[] = [
    { label: 'Nuevo paciente', send: 'nuevo paciente' },
    { label: 'Buscar paciente', send: 'paciente' },
  ];
  const prev = lastPatient.get(from);
  if (prev) opciones.push({ label: 'Paciente anterior', send: `activar paciente ${prev.id}` });
  await sendOpciones(from,
    `Hola 👋 ¿Qué quieres hacer?${prev ? `\nPaciente anterior: ${prev.name}` : ''}`, opciones);
}

/**
 * Corre un turno en el cerebro y entrega la respuesta. Antes va el aviso de
 * «pensando» con su ventana de gracia. `cancelado`: la persona tocó «Cancelar»
 * y el mensaje no se procesó. `error`: el turno falló y ya se le avisó.
 */
async function routeTurn(
  ctx: Turno, cuerpo: Record<string, unknown>, textoAviso: string,
): Promise<'ok' | 'cancelado' | 'error'> {
  const { invokeChat, from } = ctx;
  // Una sesión por paciente: el hilo de un paciente se arma con las sesiones
  // que lo tienen activo, así que activar a otro dentro de la misma sesión se
  // llevaría toda la conversación al hilo del nuevo. Se empieza una sesión.
  const otro = String((cuerpo as any).message || '').match(/^\/?\s*activar\s+paciente\s+([0-9a-f-]{36})\s*$/i);
  const actual = eco.pacienteDe(from);
  if (otro && actual && otro[1].toLowerCase() !== actual.toLowerCase()) {
    phoneSessions.delete(from);
    pacienteActivo.delete(from);
    eco.soltar(from);
  }
  // Soltar al paciente es cosa del canal, no del cerebro: allá «salir paciente»
  // le borra el paciente activo a la sesión, y el hilo del paciente se arma con
  // las sesiones que lo tienen activo — toda la conversación desaparecía del
  // chat de la web. Acá la sesión simplemente termina, intacta.
  if (actual && SUELTA_PACIENTE.test(String((cuerpo as any).message || ''))) {
    const nombre = nombreDelActivo(from);
    crudo.anotar(from, { dir: 'sys', tipo: 'suelta', texto: nombre });
    await sendWhatsappText(from, `Listo, dejé a *${nombre}*.`);
    await sendMenu(from);
    return 'ok';
  }
  // Buscar o crear OTRO paciente con uno activo: el cerebro, con paciente activo,
  // no entra a la búsqueda —manda el pedido al agente, que contesta «¿Qué paciente
  // buscás?» dentro de la sesión del paciente actual—. El canal cierra antes la
  // sesión de este paciente y el pedido arranca una limpia.
  if (actual && ENTRA_A_OTRO.test(String((cuerpo as any).message || ''))) {
    const nombre = nombreDelActivo(from);
    phoneSessions.delete(from);
    pacienteActivo.delete(from);
    eco.soltar(from);
    crudo.anotar(from, { dir: 'sys', tipo: 'suelta', texto: nombre });
    await sendWhatsappText(from, `Dejé a *${nombre}*.`);
  }
  const sessionId = phoneSessions.get(from) || undefined;

  // «Pensando»: el aviso con su botón «Cancelar», la ventana de gracia y recién
  // después el «escribiendo…» (cualquier mensaje saliente lo apaga, y antes de
  // que venza la ventana todavía no se está procesando nada).
  const aviso = avisoContinuando(sessionId ? pacienteActivo.get(from) : undefined, textoAviso);
  if (aviso) {
    const ms = graciaMs();
    if (!ms) await sendWhatsappText(from, aviso);
    else {
      const { token, espera } = abrirGracia(from, ms);
      await sendWhatsappAviso(from, aviso, token);
      if (!(await espera)) {
        console.log(`[whatsapp] ${from} canceló el turno en la ventana de gracia`);
        crudo.anotar(from, { dir: 'sys', tipo: 'cancelado', texto: textoAviso });
        return 'cancelado';
      }
    }
  }
  await sendWhatsappTyping(ctx.msgId);

  const eventos = crudo.tomar(from);
  let status = 500; let body: any = null;
  try {
    ({ status, body } = await invokeChat({
      headers: { authorization: `Bearer ${ctx.jwt}` },
      body: { ...cuerpo, session_id: sessionId, canal: 'whatsapp', canal_raw: eventos },
    }));
  } catch (e: any) {
    body = { ok: false, error: e?.message || String(e) };
  }
  if (status !== 200 || body?.ok === false) {
    crudo.devolver(from, eventos);
    console.error(`[whatsapp] chat turn failed ${status}: ${body?.error || 'no error message'}`);
    await sendWhatsappText(from, 'No pude procesar tu mensaje. Prueba de nuevo en un rato.');
    return 'error';
  }
  await deliver(ctx, body);
  return 'ok';
}

/**
 * Entrega una respuesta del cerebro. Una sección de la ficha o el alta de
 * paciente se recorren campo por campo; lo demás sale como texto con opciones.
 */
async function deliver(ctx: Turno, body: any): Promise<void> {
  const { from } = ctx;
  // Remember the session for this phone; drop it when the session closes.
  if (body?.session_id) {
    if (body?.session_closed) phoneSessions.delete(from);
    else phoneSessions.set(from, body.session_id);
    const paciente = body?.session_closed ? '' : pacienteDeRespuesta(body);
    if (paciente) pacienteActivo.set(from, paciente);
    else pacienteActivo.delete(from);
    if (paciente) lastPatient.set(from, { id: body.active_patient_id, name: paciente });

    // Eco del hilo: vale mientras ESTE paciente siga activo en el teléfono.
    const pid = body?.session_closed ? '' : String(body?.active_patient_id || '');
    const previo = eco.pacienteDe(from);
    if (pid) eco.fijar(from, pid);
    // Solo si la respuesta dice explícitamente que no hay paciente: una que no
    // trae el campo no es un «lo soltó».
    if (!pid && previo && body && 'active_patient_id' in body) {
      // Soltó al paciente: se corta el eco y la sesión termina con él (una
      // sesión por paciente; la siguiente empieza limpia).
      eco.soltar(from);
      phoneSessions.delete(from);
    }
  }

  // Con `pending_action` el cerebro espera un sí/no, no un formulario: puede
  // traer pegado el formulario anterior y recorrerlo otra vez trabaría el alta.
  if (isWalkableForm(body?.form) && !body?.pending_action) {
    // La sección de la ficha se muestra entera como contexto; el alta de
    // paciente va directo a su primera pregunta.
    const intro = body.form.id.startsWith('ficha_grp_')
      ? composeReply(body) + '\n\n_«Saltar» deja un campo sin contestar. «Omitir restante» (o escribirlo) termina la sección: lo ya contestado se guarda._'
      : composeReply({ ...body, form: null });
    formWalks.set(from, { form: body.form, idx: 0, answers: {} });
    await sendWhatsappText(from, intro);
    await askWalkField(ctx);
    return;
  }
  formWalks.delete(from);
  const rapidas: Opcion[] = Array.isArray(body?.quick_replies) && body.quick_replies.length
    ? body.quick_replies.map((q: QuickReply) => ({ label: q.label, send: q.send }))
    : body?.pending_action
      ? [{ label: '✅ Sí', send: 'sí' }, { label: '❌ No', send: 'no' }]
      : [];
  // Búsqueda con un único resultado: se activa sin hacerle elegir entre una
  // sola opción. Con varios, elige de la lista.
  const hallados = rapidas.filter(o => /^activar\s+paciente\s+[0-9a-f-]{36}$/i.test(o.send || ''));
  if (hallados.length === 1 && !body?.active_patient_id) {
    await routeTurn(ctx, { message: hallados[0].send! }, '');
    return;
  }
  const acciones: Opcion[] = (body?.form?.actions || []).map((a: any) => ({ label: a.label, send: a.send }));
  await sendOpciones(from, textoConPendiente(body), rapidas, acciones);
  // La respuesta no traía pregunta: si la ficha sigue abierta, se retoma. Un
  // comando (una nota, ver el chatter) no puede dejar al médico sin saber qué sigue.
  if (!rapidas.length && body?.active_patient_id && !body?.session_closed) await reanudarFicha(ctx);
}

/**
 * Sale de un recorrido sin perder lo contestado: si es una sección de la ficha
 * con respuestas, las envía al cerebro tal como están (una sección incompleta
 * se guarda igual, campo por campo) y recién entonces lo cierra. La respuesta
 * del cerebro a ese envío no se muestra: quien sale ya va a otra cosa.
 */
async function guardarParcial(ctx: Turno, w: FormWalk): Promise<void> {
  const { from } = ctx;
  formWalks.delete(from);
  if (w.form.submit_mode !== 'structured' || !Object.keys(w.answers).length) return;
  const eventos = crudo.tomar(from);
  try {
    const { status, body } = await ctx.invokeChat({
      headers: { authorization: `Bearer ${ctx.jwt}` },
      body: { ...cuerpoDeEnvio(w), session_id: phoneSessions.get(from), canal: 'whatsapp', canal_raw: eventos },
    });
    if (status !== 200 || body?.ok === false) throw new Error(body?.error || `estado ${status}`);
    await sendWhatsappText(from, `💾 Guardé lo que llevabas de «${w.form.title}».`);
  } catch (e: any) {
    crudo.devolver(from, eventos);
    console.error('[whatsapp] guardado parcial:', e?.message || e);
    await sendWhatsappText(from, `⚠️ No pude guardar lo que llevabas de «${w.form.title}».`);
  }
}

/**
 * «Omitir restante»: termina la sección. Con respuestas, se envía con lo que
 * tiene (el cerebro guarda y pasa a la siguiente); sin ninguna, se omite.
 */
async function omitirSeccion(ctx: Turno, w: FormWalk): Promise<void> {
  if (w.form.submit_mode === 'structured' && Object.keys(w.answers).length) {
    w.idx = w.form.fields.length;
    await submitWalk(ctx);
    return;
  }
  formWalks.delete(ctx.from);
  await routeTurn(ctx, { message: 'omitir ficha' }, 'omitir ficha');
}

/**
 * El texto de una respuesta, recordando la confirmación que sigue abierta. Los
 * botones Sí/No salen en toda respuesta mientras haya una acción pendiente; si
 * la respuesta habla de otra cosa («No hay recordatorios»), hay que decir a qué
 * se le está diciendo que sí.
 */
function textoConPendiente(body: any): string {
  const texto = composeReply(body);
  const resumen = body?.pending_action?.summary;
  return resumen && !/¿Confirmas\?/i.test(texto) ? `${texto}\n\n⏳ Sigue pendiente de confirmar: ${resumen}. ¿Confirmas?` : texto;
}

/**
 * Retoma la sección de la ficha que la sesión tiene abierta, si la hay: la pide
 * al cerebro (`GET /api/bot/session/:id`, que la devuelve con lo ya guardado) y
 * sigue preguntando lo que falta.
 */
async function reanudarFicha(ctx: Turno): Promise<void> {
  const { from } = ctx;
  const sessionId = phoneSessions.get(from);
  if (!sessionId || formWalks.has(from)) return;
  const base = process.env.CEPI_BOT_URL || `http://localhost:${process.env.PORT || '3002'}`;
  let s: any = null;
  try {
    const r = await fetch(`${base}/api/bot/session/${sessionId}`, { headers: { authorization: `Bearer ${ctx.jwt}` } });
    if (r.ok) s = await r.json().catch(() => null);
  } catch { s = null; }
  if (!s?.ok || s.pending_action || s.pendiente || !isWalkableForm(s.form) || !s.form.id.startsWith('ficha_grp_')) return;
  formWalks.set(from, { form: s.form, idx: 0, answers: {} });
  await sendWhatsappText(from, `Sigamos con la ficha: *${s.form.title}*`);
  await askWalkField(ctx);
}

/** Pregunta el campo actual del recorrido. Cuando no queda ninguno, envía. */
async function askWalkField(ctx: Turno): Promise<void> {
  const { from } = ctx;
  const w = formWalks.get(from);
  if (!w) return;
  // Se saltan los títulos y lo que ya tiene valor en la ficha: solo se pregunta lo que falta.
  while (w.idx < w.form.fields.length
    && (w.form.fields[w.idx].type === 'heading' || yaTieneValor(w, w.form.fields[w.idx]))) w.idx++;
  if (w.idx >= w.form.fields.length) { await submitWalk(ctx); return; }

  const f = w.form.fields[w.idx];
  const { pos, n } = posicion(w);
  // Dos salidas distintas, con nombres que no se confunden: «Saltar» deja ESTE
  // campo sin contestar y sigue; «Omitir restante» termina la sección (lo ya
  // contestado se guarda). Un «Omitir» a secas se leía como lo primero y hacía
  // lo segundo, perdiendo las respuestas.
  // (En el alta de paciente no hay «Saltar»: sus tres campos son obligatorios.)
  const acciones: Opcion[] = [
    ...(w.form.submit_mode === 'structured' ? [{ label: 'Saltar', accion: 'saltar' as const }] : []),
    ...(w.form.actions || []).map(a => /^omitir/i.test(a.send || '')
      ? { label: 'Omitir restante', send: 'omitir ficha' } : { label: a.label, send: a.send }),
  ];
  if (f.type === 'radio' || f.type === 'checkbox') {
    // Con Sí/No caben tres botones: las dos respuestas y «Saltar». «Omitir
    // sección» queda escrito (lo dice la presentación de la sección).
    const opciones = walkOptions(f).map(o => ({ label: String(o.label), value: o.value, esValor: true }));
    // Hasta 3 respuestas van como botones, con las salidas que quepan al lado;
    // las que no caben se escriben («saltar», «omitir restante»). Así una
    // pregunta de tres opciones no se esconde detrás de «Ver opciones».
    await sendOpciones(from, `(${pos}/${n}) ${f.label}`, opciones,
      opciones.length <= MAX_BOTONES ? acciones.slice(0, MAX_BOTONES - opciones.length) : acciones);
  } else if (f.type === 'image_upload') {
    // «Listo» aparece recién cuando hay algo que enviar.
    const ids = idsDelCampo(w, f.key);
    const texto = ids.length
      ? `(${pos}/${n}) ${f.label}\n📷 ${ids.length === 1 ? '1 imagen recibida' : `${ids.length} imágenes recibidas`}. Envía otra o toca «Listo».`
      : `(${pos}/${n}) ${f.label}\nEnvía ${(f as any).multiple ? 'la(s) imagen(es)' : 'la imagen'} como foto.`;
    await sendOpciones(from, texto,
      ids.length ? [{ label: 'Listo', value: ids.join(','), esValor: true }] : [], acciones);
  } else {
    const hint = f.placeholder ? ` (${f.placeholder})` : '';
    await sendOpciones(from, `(${pos}/${n}) ${f.label}${hint}`, [], acciones);
  }
}

/** Guarda la respuesta del campo actual y avanza. */
async function applyWalkAnswer(ctx: Turno, value: any): Promise<void> {
  const w = formWalks.get(ctx.from);
  if (!w) return;
  const f = w.form.fields[w.idx];
  if (f?.key) w.answers[f.key] = value;
  w.idx++;
  await askWalkField(ctx);
}

/** Todos los campos contestados: se envía el formulario al cerebro. */
async function submitWalk(ctx: Turno): Promise<void> {
  const { from } = ctx;
  const w = formWalks.get(from);
  if (!w) return;
  // Un recorrido donde no quedó nada que mandar (solo imágenes) no se envía vacío.
  if (w.form.submit_mode === 'structured' && !Object.keys(w.answers).length) {
    formWalks.delete(from);
    await routeTurn(ctx, { message: 'omitir ficha' }, 'omitir ficha');
    return;
  }
  const cuerpo = cuerpoDeEnvio(w);
  const r = await routeTurn(ctx, cuerpo, 'message' in cuerpo ? cuerpo.message : '');
  // Cancelado o fallido: nada se envió. El recorrido conserva sus respuestas y
  // vuelve a preguntar el último campo. (Con `ok`, `deliver` ya lo cerró o abrió el siguiente.)
  if (r !== 'ok' && formWalks.get(from) === w) {
    w.idx = ultimoCampo(w);
    await askWalkField(ctx);
  }
}

/**
 * Check Meta's `X-Hub-Signature-256: sha256=<hex>` header against the HMAC of
 * the raw request body. Without it anyone who knows the URL could post a fake
 * "message" from any phone and have the bot write as the service account.
 * Fails closed: no secret, no header or a malformed one ⇒ false.
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !rawBody || !header?.startsWith('sha256=')) return false;
  const got = Buffer.from(header.slice('sha256='.length), 'hex');
  const want = createHmac('sha256', secret).update(rawBody).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Start the WhatsApp webhook listener. Returns the http.Server so the caller
 * can close it on shutdown.
 */
export function startWhatsapp(invokeChat: InvokeChat) {
  cerebro = invokeChat;
  restaurarEstado();
  // Al apagar (un deploy), lo último que cambió queda escrito.
  for (const señal of ['SIGINT', 'SIGTERM'] as const) process.once(señal, () => estado.guardarYa(fotoDelEstado));
  const app = express();
  // Keep the raw bytes: the signature is over the body exactly as Meta sent it.
  app.use(express.json({
    limit: '5mb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }));
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.warn('[whatsapp] WHATSAPP_APP_SECRET unset: every webhook POST will be refused');
  }

  app.get('/health', (_req: Request, res: Response) =>
    res.json({ ok: true, service: 'cepi-bot-whatsapp' }));

  // Meta webhook verification handshake.
  app.get('/whatsapp', (req: Request, res: Response) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(String(challenge ?? ''));
    }
    return res.sendStatus(403);
  });

  // TodoERP avisa que una identidad pendiente fue aprobada (ver avisarRegistroListo).
  app.post('/interno/identidad-activada', async (req: Request, res: Response) => {
    if (!esLocal(req)) return res.sendStatus(403);
    const { platform, external_id } = req.body || {};
    if (!external_id) return res.json({ ok: true, resultado: 'omitido' });
    // El ERP avisa a una sola URL para todos los canales; Telegram cuelga de acá.
    if (platform === 'telegram') {
      try {
        const { avisarRegistroListoTelegram } = await import('./telegram.js');
        return res.json({ ok: true, resultado: await avisarRegistroListoTelegram(Number(external_id)) });
      } catch (e: any) {
        console.error('[telegram] aviso de registro listo:', e?.message || e);
        return res.status(500).json({ ok: false });
      }
    }
    if (platform !== 'whatsapp') return res.json({ ok: true, resultado: 'omitido' });
    const digitos = String(external_id).replace(/\D/g, '');
    try {
      res.json({ ok: true, resultado: await avisarRegistroListo(digitos) });
    } catch (e: any) {
      console.error('[whatsapp] aviso de registro listo:', e?.message || e);
      res.status(500).json({ ok: false });
    }
  });

  // Inbound messages + status callbacks.
  app.post('/whatsapp', async (req: Request, res: Response) => {
    if (!verifyMetaSignature((req as any).rawBody, req.get('x-hub-signature-256'),
                             process.env.WHATSAPP_APP_SECRET)) {
      return res.sendStatus(401);
    }
    // Ack immediately so Meta doesn't retry; process asynchronously.
    res.sendStatus(200);
    try {
      const entries = req.body?.entry || [];
      for (const entry of entries) {
        for (const change of entry?.changes || []) {
          const messages = change?.value?.messages || [];
          // El nombre del perfil viaja en `contacts`, hermano de `messages`, no
          // dentro del mensaje. Solo se usa para bautizar una identidad nueva:
          // ver un nombre en la pantalla de aprobación es la diferencia entre
          // reconocer a alguien y tener que adivinar por el número.
          const contactos: Record<string, string> = {};
          for (const c of change?.value?.contacts || []) {
            if (c?.wa_id && c?.profile?.name) contactos[String(c.wa_id)] = String(c.profile.name);
          }
          for (const msg of messages) {
            const from = String(msg?.from || '');
            // «Cancelar» del aviso va FUERA de la cola: el turno que se quiere
            // cancelar es el que la tiene ocupada mientras corre su ventana.
            const boton = msg?.interactive?.button_reply?.id;
            if (from && typeof boton === 'string' && boton.startsWith(BOTON_CANCELAR)) {
              await handleCancelar(from, boton, msg).catch(e =>
                console.error('[whatsapp] cancelar error:', e?.message || e));
              continue;
            }
            await enCola(from, () => handleInbound(invokeChat, msg, contactos[String(msg?.from)]).finally(persistir));
          }
        }
      }
    } catch (e: any) {
      console.error('[whatsapp] webhook error:', e?.message || e);
    }
  });

  const port = parseInt(process.env.WHATSAPP_WEBHOOK_PORT || '9997', 10);
  return app.listen(port, () => {
    console.log(`📲 cepi-bot WhatsApp webhook listening on :${port}`);
  });
}
