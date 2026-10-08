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
  abrirGracia, avisoContinuando, cancelarGracia, graciaMs, pacienteDeRespuesta,
  TXT_CANCELAR, TXT_CANCELADO, TXT_TARDE,
} from './canalAviso.js';

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
  if (form.submit_send) {
    lines.push('', `_Respondé con los datos y los registro._`);
  }
  return lines.join('\n');
}

/** Append quick replies as a numbered hint (WhatsApp text fallback). */
function renderQuickReplies(qr: QuickReply[]): string {
  if (!qr?.length) return '';
  return '\n\n' + qr.map((q, i) => `${i + 1}. ${q.label}`).join('\n');
}

/** Build the outbound WhatsApp text from a chat-brain response body. */
function composeReply(body: any): string {
  let text = String(body?.text || '').trim();
  if (body?.form) text += '\n' + renderForm(body.form);
  if (Array.isArray(body?.quick_replies)) text += renderQuickReplies(body.quick_replies);
  return text || '…';
}

/** Send a text message back through the WhatsApp Cloud API (best-effort). */
async function sendWhatsappText(to: string, text: string): Promise<void> {
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

/** Prefijo del id del botón «Cancelar» del aviso; lo que sigue es el token de la ventana. */
const BOTON_CANCELAR = 'cancelar:';

/**
 * El aviso de «pensando» con su botón «Cancelar» (mensaje interactivo). WhatsApp
 * no deja editar ni retirar el botón después: un toque tardío recibe TXT_TARDE.
 */
async function sendWhatsappAviso(to: string, text: string, token: string): Promise<void> {
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

  // Toque en «Cancelar» del aviso: cierra la ventana de gracia de ese turno.
  const boton = msg?.interactive?.button_reply?.id;
  if (typeof boton === 'string' && boton.startsWith(BOTON_CANCELAR)) {
    const ok = cancelarGracia(boton.slice(BOTON_CANCELAR.length), from);
    await sendWhatsappText(from, ok ? TXT_CANCELADO : TXT_TARDE);
    return;
  }

  // Only plain text is routed for now (images/audio would map to attachments).
  const text = msg?.text?.body;
  if (typeof text !== 'string' || !text.trim()) {
    await sendWhatsappText(from, 'Por ahora solo proceso mensajes de texto.');
    return;
  }
  const sessionId = phoneSessions.get(from) || undefined;

  // «Pensando»: el aviso con su botón «Cancelar», la ventana de gracia y recién
  // después el «escribiendo…» (cualquier mensaje saliente lo apaga, y antes de
  // que venza la ventana todavía no se está procesando nada).
  const aviso = avisoContinuando(sessionId ? pacienteActivo.get(from) : undefined, text);
  if (aviso) {
    const ms = graciaMs();
    if (!ms) await sendWhatsappText(from, aviso);
    else {
      const { token, espera } = abrirGracia(from, ms);
      await sendWhatsappAviso(from, aviso, token);
      if (!(await espera)) { console.log(`[whatsapp] ${from} canceló el turno en la ventana de gracia`); return; }
    }
  }
  await sendWhatsappTyping(msg?.id);

  const { status, body } = await invokeChat({
    headers: { authorization: `Bearer ${auth.jwt}` },
    body: { message: text, session_id: sessionId },
  });
  if (status !== 200 || body?.ok === false) {
    console.error(`[whatsapp] chat turn failed ${status}: ${body?.error || 'no error message'}`);
    await sendWhatsappText(from, 'No pude procesar tu mensaje. Prueba de nuevo en un rato.');
    return;
  }

  // Remember the session for this phone; drop it when the session closes.
  if (body?.session_id) {
    if (body?.session_closed) phoneSessions.delete(from);
    else phoneSessions.set(from, body.session_id);
    const paciente = body?.session_closed ? '' : pacienteDeRespuesta(body);
    if (paciente) pacienteActivo.set(from, paciente);
    else pacienteActivo.delete(from);
  }

  await sendWhatsappText(from, composeReply(body));
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
    if (platform !== 'whatsapp' || !external_id) return res.json({ ok: true, resultado: 'omitido' });
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
            await handleInbound(invokeChat, msg, contactos[String(msg?.from)]).catch(e =>
              console.error('[whatsapp] handle error:', e?.message || e));
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
