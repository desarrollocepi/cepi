/**
 * Telegram Bot API adapter for cepi-bot.
 *
 * Mirrors `whatsapp.ts`: runs a second Express listener (default :9998) that
 * receives Telegram webhook updates and routes every inbound message through
 * the SAME chat brain the medical frontend uses (`invokeChat` in server.ts).
 * Text goes straight through; an inbound photo (or image/* document) is
 * downloaded, uploaded to TodoERP /api/attachments and turned into the
 * `[adjunto: name · uuid]` token the brain recognises — the same path the
 * frontend uses, so it lands as a clinical_image (with the usual gate). The
 * bot's structured reply (text + optional BotForm + quick replies) is degraded
 * to plain Telegram messages, since Telegram can't render inline cepi forms.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN      Bot API token from @BotFather (SECRET → .env)
 *   TELEGRAM_WEBHOOK_PORT   listen port (default 9998)
 *   TELEGRAM_PUBLIC_URL     public HTTPS base (e.g. the ngrok URL); when set,
 *                           the adapter self-registers the webhook on startup.
 *                           Leave empty to manage the webhook manually.
 *   TELEGRAM_WEBHOOK_SECRET optional token Telegram echoes in the
 *                           X-Telegram-Bot-Api-Secret-Token header (verified)
 *   TELEGRAM_BOT_EMAIL / TELEGRAM_BOT_PASSWORD   service account → JWT per turn
 *                           (falls back to WHATSAPP_BOT_* then CEPI_GUEST_API_KEY)
 *   CEPI_GUEST_API_KEY      identity invokeChat uses when no service JWT
 *
 * Auth model is identical to the WhatsApp adapter: Telegram users have no
 * TodoERP JWT of their own, so the adapter authenticates as a single service
 * account and forwards that JWT on every turn — every write is attributed to
 * that user and goes through the normal permission checks.
 */
import express, { Request, Response } from 'express';
import type { BotForm, BotFormField, QuickReply } from './flowV1.js';

const WEBHOOK_PATH = '/telegram/webhook';

/** Cached service-account JWT + its expiry (epoch seconds). */
let svcJwt: { token: string; exp: number } | null = null;

/**
 * Return a valid service-account JWT, logging in to TodoERP when missing or
 * within 60s of expiry. This is the ADMIN bot account used only to resolve /
 * link chat identities — it is NOT the identity messages act with. Returns ''
 * when no service credentials are configured.
 */
async function getServiceJwt(): Promise<string> {
  const email = process.env.TELEGRAM_BOT_EMAIL || process.env.WHATSAPP_BOT_EMAIL;
  const password = process.env.TELEGRAM_BOT_PASSWORD || process.env.WHATSAPP_BOT_PASSWORD;
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
    if (!token) { console.error('[telegram] login: no token in response'); return ''; }
    let exp = now + 3600;
    try { exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')).exp || exp; } catch {}
    svcJwt = { token, exp };
    return token;
  } catch (e: any) {
    console.error('[telegram] service login failed:', e?.message || e);
    return '';
  }
}

/** chat_id → JWT of the registered user acting in this chat. */
const chatAuth = new Map<number, string>();

type ResolveResult =
  | { ok: true; jwt: string }
  | { ok: false; reason: 'unregistered' | 'error' };

/**
 * Resolve the TodoERP user linked to a chat identity and return a JWT to act
 * AS that user (their real role/permissions). Uses the admin service account
 * to call the resolve endpoint. `unregistered` ⇒ no user linked to this id.
 */
async function resolveUserAuth(
  platform: string, externalId: string | number, nombre?: string,
): Promise<ResolveResult> {
  const adminJwt = await getServiceJwt();
  if (!adminJwt) {
    console.error('[telegram] no service account configured to resolve identity');
    return { ok: false, reason: 'error' };
  }
  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  // Igual que en WhatsApp: la organización acota a quién alcanza este canal
  // (PAPER §27.4) y sin ella el turno correría sin org activa, que es no estar
  // limitado a nada. Va por configuración; el ERP no sabe qué es telemedicina.
  const org = process.env.TELEGRAM_BOT_ORG || process.env.CEPI_BOT_ORG || '';
  if (!org) {
    console.error('[telegram] falta TELEGRAM_BOT_ORG: sin organización no se resuelve');
    return { ok: false, reason: 'error' };
  }
  const ruta = process.env.TELEGRAM_BOT_AUTOALTA === '1' ? 'ensure' : 'resolve';
  try {
    const r = await fetch(`${base}/api/auth/external/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminJwt}` },
      body: JSON.stringify({
        platform, external_id: String(externalId), org, ...(nombre ? { name: nombre } : {}),
      }),
    });
    if (r.status === 404) return { ok: false, reason: 'unregistered' };
    if (!r.ok) { console.error('[telegram] resolve failed', r.status); return { ok: false, reason: 'error' }; }
    const data: any = await r.json().catch(() => ({}));
    return data?.token ? { ok: true, jwt: data.token } : { ok: false, reason: 'error' };
  } catch (e: any) {
    console.error('[telegram] resolve error:', e?.message || e);
    return { ok: false, reason: 'error' };
  }
}

/** Link a chat id to a user (admin only — enforced by the endpoint). */
async function linkExternal(
  actingJwt: string, platform: string, externalId: string | number, email: string,
): Promise<'ok' | 'forbidden' | 'user_not_found' | 'error'> {
  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  try {
    const r = await fetch(`${base}/api/auth/external/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${actingJwt}` },
      body: JSON.stringify({ platform, external_id: String(externalId), email }),
    });
    if (r.status === 403) return 'forbidden';
    if (r.status === 404) return 'user_not_found';
    if (!r.ok) return 'error';
    return 'ok';
  } catch (e: any) {
    console.error('[telegram] link error:', e?.message || e);
    return 'error';
  }
}

type InvokeChat = (input: {
  body: any;
  headers?: Record<string, string>;
}) => Promise<{ status: number; body: any }>;

/** chat_id → cepi-bot session_id. In-memory: fine for testing. */
const chatSessions = new Map<number, string>();

/** chat_id → epoch ms of the last interaction (for the idle "new chat" reset). */
const lastSeen = new Map<number, number>();

/** chat_id → last active patient (to offer "paciente anterior" after a reset). */
const lastPatient = new Map<number, { id: string; name: string }>();

/** chat_id → pending idle timer that proactively sends the menu after IDLE_MS. */
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** chat_id → in-progress ficha form walk (asks closed questions one by one). */
interface FormWalk { form: BotForm; idx: number; answers: Record<string, any>; }
const formWalks = new Map<number, FormWalk>();

/**
 * chat_id → tail of a per-chat promise chain. Telegram delivers updates for a
 * chat without waiting for our previous one to finish, so two quick messages
 * (e.g. tapping "nuevo paciente" then immediately typing the cédula) can run
 * concurrently and race the walk registration — resurfacing the very
 * search-branch bug the walk fixes. Serialising per chat makes each update see
 * the state the previous one left. Keyed by chat so distinct chats stay
 * parallel; entries are pruned when their chain drains.
 */
const chatQueues = new Map<number, Promise<void>>();
function serialize(chatId: number, task: () => Promise<void>): Promise<void> {
  const prev = chatQueues.get(chatId) || Promise.resolve();
  const next = prev.then(task, task).catch(e =>
    console.error('[telegram] queued task error:', e?.message || e));
  chatQueues.set(chatId, next);
  // Drop the entry once this is the last task in the chain (avoid leaking a
  // map entry per chat forever).
  next.finally(() => { if (chatQueues.get(chatId) === next) chatQueues.delete(chatId); });
  return next;
}

/** Idle window after which the chat is proactively reset to the "new chat" menu. */
const IDLE_MS = 5 * 60 * 1000;

/**
 * Mark activity on a chat and (re)arm its idle timer. After IDLE_MS with no
 * further activity the timer fires and proactively sends the "new chat" menu —
 * the message goes out AT the 5-minute mark, not on the user's next message.
 */
function touch(chatId: number): void {
  lastSeen.set(chatId, Date.now());
  const existing = idleTimers.get(chatId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => { void onIdle(chatId); }, IDLE_MS);
  if (typeof (t as any).unref === 'function') (t as any).unref();  // don't keep the process alive
  idleTimers.set(chatId, t);
}

/** Idle timer fired: proactively show the menu and reset the chat's session. */
async function onIdle(chatId: number): Promise<void> {
  idleTimers.delete(chatId);
  await sendWelcomeMenu(chatId);
  // The menu was just shown; treat the user's next message as a normal turn.
  lastSeen.set(chatId, Date.now());
}

/** Render a BotForm as plain text so a Telegram user can still answer it. */
function renderForm(form: BotForm): string {
  const lines: string[] = ['', `📋 ${form.title}`];
  for (const f of form.fields as BotFormField[]) {
    if (f.type === 'heading') { lines.push(`\n${f.label}`); continue; }
    const req = f.required ? ' (requerido)' : '';
    let opts = '';
    if (Array.isArray(f.options) && f.options.length) {
      const labels = f.options.map(o => (typeof o === 'string' ? o : o.label));
      opts = ` [${labels.join(' / ')}]`;
    }
    lines.push(`• ${f.label}${req}${opts}`);
  }
  if (form.submit_send) {
    lines.push('', 'Respondé con los datos y los registro.');
  }
  return lines.join('\n');
}

/**
 * Quick-reply `send` payloads can exceed Telegram's 64-byte callback_data
 * limit (e.g. "activar paciente <uuid>"), so we keep a short id → send map and
 * put only the id in callback_data. Bounded FIFO to avoid unbounded growth.
 */
const callbackSends = new Map<string, string>();
let cbCounter = 0;
function registerCallback(send: string): string {
  const id = `q${(cbCounter++).toString(36)}`;
  callbackSends.set(id, send);
  if (callbackSends.size > 2000) {
    const oldest = callbackSends.keys().next().value;
    if (oldest !== undefined) callbackSends.delete(oldest);
  }
  return id;
}

/**
 * Build an inline keyboard (one button per row) from the brain's quick replies.
 * `callback_data` carries the `send` payload directly when it fits Telegram's
 * 64-byte limit (stateless → survives bot restarts); longer payloads fall back
 * to the in-memory id map.
 */
function buildKeyboard(qr: QuickReply[] | undefined): any | undefined {
  if (!Array.isArray(qr) || !qr.length) return undefined;
  return {
    inline_keyboard: qr.map(q => [{
      text: q.label,
      callback_data: Buffer.byteLength(q.send, 'utf8') <= 64 ? q.send : registerCallback(q.send),
    }]),
  };
}

/**
 * Build the outbound Telegram text from a chat-brain response body. The first
 * line is the status header (active patient name, or chat state). Quick replies
 * are NOT inlined here — they become inline keyboard buttons (see buildKeyboard).
 */
function composeReply(body: any): string {
  const header = String(body?.status_header || '').trim();
  let text = String(body?.text || '').trim();
  if (body?.form) text += '\n' + renderForm(body.form);
  text = text || '…';
  return header ? `${header}\n${text}` : text;
}

/**
 * Send a message back through the Telegram Bot API (best-effort). Telegram caps
 * messages at 4096 chars; we slice to stay under it. We send without parse_mode
 * so the plain-text form rendering can't trip entity parsing. `replyMarkup`
 * attaches an inline keyboard when provided.
 */
async function sendTelegramText(chatId: number, text: string, replyMarkup?: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log(`[telegram] (dry-run, no TELEGRAM_BOT_TOKEN) → ${chatId}: ${text}`);
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!r.ok) console.error(`[telegram] send failed ${r.status}: ${await r.text()}`);
  } catch (e: any) {
    console.error('[telegram] send error:', e?.message || e);
  }
}

/** Acknowledge a tapped inline button so Telegram stops the loading spinner. */
async function answerCallback(callbackQueryId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch { /* best-effort */ }
}

/**
 * Download a Telegram file by file_id: resolve its path via getFile, then
 * fetch the bytes from the file CDN. Returns null on any failure.
 */
async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const info: any = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`)
      .then(r => r.json());
    const filePath = info?.result?.file_path;
    if (!filePath) { console.error('[telegram] getFile: no file_path', JSON.stringify(info)); return null; }
    const r = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!r.ok) { console.error(`[telegram] file download ${r.status}`); return null; }
    const buffer = Buffer.from(await r.arrayBuffer());
    // Infer mime from the extension Telegram gave the stored path.
    const ext = (filePath.split('.').pop() || 'jpg').toLowerCase();
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'heic' ? 'image/heic'
      : 'image/jpeg';
    return { buffer, mime };
  } catch (e: any) {
    console.error('[telegram] downloadTelegramFile error:', e?.message || e);
    return null;
  }
}

/** Upload bytes to TodoERP /api/attachments as the service account. Returns the attachment id. */
async function uploadAttachment(jwt: string, buffer: Buffer, filename: string, mime: string): Promise<string | null> {
  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  try {
    // Copy into a fresh Uint8Array so the Blob is backed by a plain
    // ArrayBuffer (TS rejects Buffer's ArrayBufferLike as a BlobPart).
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: mime }), filename);
    const r = await fetch(`${base}/api/attachments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: fd,
    });
    if (!r.ok) { console.error(`[telegram] attachment upload ${r.status}: ${await r.text()}`); return null; }
    const data: any = await r.json().catch(() => ({}));
    const att = Array.isArray(data) ? data[0] : data;
    return att?.id || null;
  } catch (e: any) {
    console.error('[telegram] uploadAttachment error:', e?.message || e);
    return null;
  }
}

/**
 * If the message carries an image (photo, or an image/* document), download it,
 * upload it to TodoERP and return the `[adjunto: name · uuid]` token the chat
 * brain recognises (same path the frontend uses). Returns '' when there's no
 * image; returns null on a failure the caller should report to the user.
 */
async function resolveImageToken(message: any, jwt: string): Promise<string | null | ''> {
  // photo = array of progressively larger sizes; the last is the largest.
  const photo = Array.isArray(message?.photo) && message.photo.length
    ? message.photo[message.photo.length - 1]
    : null;
  const doc = message?.document && typeof message.document?.mime_type === 'string'
    && message.document.mime_type.startsWith('image/')
    ? message.document : null;
  if (!photo && !doc) return '';

  const fileId = photo?.file_id || doc?.file_id;
  const file = await downloadTelegramFile(fileId);
  if (!file) return null;

  // Filename must not contain '·' (the token delimiter the brain parses).
  const rawName = doc?.file_name || `telegram_${photo?.file_unique_id || Date.now()}.jpg`;
  const name = rawName.replace(/·/g, '-');
  const id = await uploadAttachment(jwt, file.buffer, name, doc?.mime_type || file.mime);
  if (!id) return null;
  return `[adjunto: ${name} · ${id}]`;
}

/**
 * Show the "new chat" menu: New patient / Search patient / (Previous patient).
 * Resets the chat's session so the next turn starts fresh (unset mode).
 */
async function sendWelcomeMenu(chatId: number): Promise<void> {
  chatSessions.delete(chatId);   // fresh session on the next turn
  formWalks.delete(chatId);      // abandon any half-filled ficha walk
  const buttons: QuickReply[] = [
    { label: '➕ Nuevo paciente', send: 'nuevo paciente' },
    { label: '🔍 Buscar paciente', send: 'paciente' },
  ];
  const prev = lastPatient.get(chatId);
  if (prev) buttons.push({ label: `↩️ Anterior: ${prev.name}`, send: `activar paciente ${prev.id}` });
  await sendTelegramText(chatId, 'Hola 👋 ¿Qué querés hacer?', buildKeyboard(buttons));
}

/** True when this chat has been idle long enough to count as a new conversation. */
function isNewChat(chatId: number): boolean {
  const seen = lastSeen.get(chatId);
  return seen === undefined || (Date.now() - seen) > IDLE_MS;
}

/** Nombre legible de un `from` de Telegram, para bautizar una identidad nueva. */
function nombreDe(from: any): string | undefined {
  const n = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
  return n || (from?.username ? `@${from.username}` : undefined);
}

/**
 * Resolve the acting user for an inbound chat. Returns their JWT, or sends the
 * appropriate message (not-registered with their id, or a transient error) and
 * returns null so the caller stops.
 */
async function authorizeChat(chatId: number, fromId: number, nombre?: string): Promise<string | null> {
  // `nombre` solo bautiza una identidad nueva: ver un nombre en la pantalla de
  // aprobación es la diferencia entre reconocer a alguien y adivinar por el id.
  const auth = await resolveUserAuth('telegram', fromId, nombre);
  if (auth.ok) { chatAuth.set(chatId, auth.jwt); return auth.jwt; }
  if (auth.reason === 'unregistered') {
    await sendTelegramText(chatId,
      `🔒 No estás registrado para usar este bot.\n\n` +
      `Tu ID de Telegram es: ${fromId}\n` +
      `Pasáselo al administrador para que te dé acceso.`);
  } else {
    await sendTelegramText(chatId, 'No pude validar tu identidad ahora mismo. Probá de nuevo en un rato.');
  }
  return null;
}

/** Process one inbound message object from the webhook update. */
async function handleInbound(invokeChat: InvokeChat, message: any): Promise<void> {
  const chatId = message?.chat?.id;
  if (typeof chatId !== 'number') return;
  const fromId = message?.from?.id;
  if (typeof fromId !== 'number') return;

  // Identity gate: every inbound is acted on AS the linked TodoERP user.
  const jwt = await authorizeChat(chatId, fromId, nombreDe(message?.from));
  if (!jwt) return;

  // Admin linking command: "vincular telegram <id> <email>".
  const linkCmd = String(message?.text || '').trim()
    .match(/^\/?\s*vincular\s+telegram\s+(\d+)\s+(\S+@\S+)\s*$/i);
  if (linkCmd) {
    const r = await linkExternal(jwt, 'telegram', linkCmd[1], linkCmd[2]);
    const msg = r === 'ok' ? `✅ Vinculé el ID ${linkCmd[1]} con ${linkCmd[2]}.`
      : r === 'forbidden' ? 'No tenés permiso para vincular usuarios.'
      : r === 'user_not_found' ? `No encontré un usuario con email ${linkCmd[2]}.`
      : 'No pude completar la vinculación.';
    await sendTelegramText(chatId, msg);
    return;
  }

  // After 5 min idle (or on first contact) treat it as a new chat: show the menu.
  const fresh = isNewChat(chatId);
  touch(chatId);
  if (fresh) {
    await sendWelcomeMenu(chatId);
    return;
  }

  // An image arrives as `photo`/`document`; its text (if any) is in `caption`.
  const hasImage = (Array.isArray(message?.photo) && message.photo.length)
    || (message?.document && String(message.document?.mime_type || '').startsWith('image/'));

  // ── Mid-walk input handling ─────────────────────────────────────────────
  // While a field-by-field walk is active, route the message to the walk
  // instead of the brain. A ficha walk lands on an active patient/episode, so
  // an inbound image legitimately supersedes it (the §4.7/§8 image flow takes
  // over the section). The patient_new walk has NO active patient yet, so an
  // image there would orphan an attachment and dump the user into the search
  // branch — reject it and keep collecting the fields.
  const activeWalk = formWalks.get(chatId);
  const fichaWalk = !!activeWalk && activeWalk.form.id.startsWith('ficha_grp_');
  if (activeWalk) {
    if (hasImage) {
      if (fichaWalk) {
        formWalks.delete(chatId);            // image flow takes over the section
      } else {
        await sendTelegramText(chatId,
          'Estoy registrando los datos del paciente — todavía no puedo recibir imágenes. ' +
          'Respondé el campo que te pedí (o escribí "cancelar").');
        await askWalkField(invokeChat, chatId);
        return;
      }
    } else {
      // Non-image: take the field answer from text OR a caption (video/voice
      // messages carry only a caption). Command-like inputs abandon capture.
      const answer = String(message?.text || message?.caption || '').trim();
      if (/^\/?\s*(cancelar|salir|men[uú])\s*$/i.test(answer)) {
        formWalks.delete(chatId);
        await sendWelcomeMenu(chatId);
        return;
      }
      // "omitir" and slash-commands aren't field values — hand them to the
      // brain so they behave like the equivalent button / typed command.
      if (/^\/?\s*omitir(\s+ficha)?\s*$/i.test(answer)) {
        formWalks.delete(chatId);
        await routeTurn(invokeChat, chatId, 'omitir ficha', jwt, '');
        return;
      }
      if (/^\//.test(answer)) {
        formWalks.delete(chatId);
        await routeTurn(invokeChat, chatId, answer, jwt, '');
        return;
      }
      if (answer) { await applyWalkAnswer(invokeChat, chatId, answer); return; }
      // Empty / contentless message mid-walk: just re-ask the current field.
      await askWalkField(invokeChat, chatId);
      return;
    }
  }

  let imageToken: string | null | '' = '';
  if (hasImage) {
    imageToken = await resolveImageToken(message, jwt);
    if (imageToken === null) {
      await sendTelegramText(chatId, 'No pude procesar la imagen. Probá de nuevo.');
      return;
    }
  }

  const caption = String(message?.text || message?.caption || '').trim();
  // Build the turn text: caption + image token (either may be empty).
  const turnText = [caption, imageToken].filter(Boolean).join('\n').trim();
  if (!turnText) {
    await sendTelegramText(chatId, 'Por ahora proceso texto e imágenes. Mandame un mensaje o una foto.');
    return;
  }

  await routeTurn(invokeChat, chatId, turnText, jwt, '');
}

/**
 * Run one chat turn for a chat and deliver the reply. Shared by text/image
 * messages and by tapped-button callbacks.
 */
async function routeTurn(
  invokeChat: InvokeChat, chatId: number, turnText: string, jwt: string, apiKey: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (jwt) headers['authorization'] = `Bearer ${jwt}`;
  else if (apiKey) headers['x-api-key'] = apiKey;
  const sessionId = chatSessions.get(chatId) || undefined;

  const { body } = await invokeChat({
    headers,
    body: { message: turnText, session_id: sessionId },
  });
  await deliver(invokeChat, chatId, body);
}

/**
 * Deliver a chat-brain response to the user. A ficha section form is shown as
 * context and then walked field-by-field (closed questions as buttons); every
 * other response is sent as text + quick-reply buttons.
 */
async function deliver(invokeChat: InvokeChat, chatId: number, body: any): Promise<void> {
  touch(chatId);

  // Remember the session for this chat; drop it when the session closes.
  if (body?.session_id) {
    if (body?.session_closed) chatSessions.delete(chatId);
    else chatSessions.set(chatId, body.session_id);
  }

  // Cache the active patient so a later "new chat" can offer "paciente anterior".
  if (body?.active_patient_id) {
    const hdr = String(body?.status_header || '');
    const m = hdr.match(/^👤\s*(.+?)(?:\s+—\s+|\s+\(|$)/);
    const name = (m ? m[1].trim() : '') || String(body.active_patient_id).slice(0, 8);
    lastPatient.set(chatId, { id: body.active_patient_id, name });
  }

  // A staged pending_action means the brain is waiting for a sí/no, NOT for a
  // form to be filled. The brain can echo a STALE `form` alongside a
  // pending_action (server.ts re-attaches the session's persisted active_form
  // to every reply that lacks one) — e.g. the patient_new form is still
  // attached on the "¿Confirmas?" turn. Restarting the walk there would
  // deadlock creation, so pending_action wins and we show the Sí/No buttons.
  if (isWalkableForm(body?.form) && !body?.pending_action) {
    // Ficha sections are shown whole as context; short forms (new patient)
    // go straight to their first question after the brain's intro text —
    // rendering the field list + "Respondé con los datos" would contradict
    // the one-by-one walk that follows.
    const intro = body.form.id.startsWith('ficha_grp_')
      ? composeReply(body)
      : composeReply({ ...body, form: null });
    formWalks.set(chatId, { form: body.form, idx: 0, answers: {} });
    await sendTelegramText(chatId, intro);
    await askWalkField(invokeChat, chatId);
  } else {
    formWalks.delete(chatId);
    // With the confirm gate enabled the brain answers "¿Confirmas?" without
    // quick replies (the web frontend renders its own ✓/✗ card) — give
    // Telegram users tappable Sí/No buttons instead of making them type.
    const keyboard = buildKeyboard(body?.quick_replies)
      ?? (body?.pending_action
        ? buildKeyboard([{ label: '✅ Sí', send: 'sí' }, { label: '❌ No', send: 'no' }])
        : undefined);
    await sendTelegramText(chatId, composeReply(body), keyboard);
  }
}

/**
 * Forms walked field-by-field: ficha sections and the new-patient form.
 * The search form stays as text — any typed text already triggers a search.
 * (Without walking `patient_new`, a user who taps "nuevo paciente" and then
 * sends just the cédula would fall through to the search branch of the brain.)
 */
function isWalkableForm(form: any): form is BotForm {
  return !!form && typeof form.id === 'string'
    && (form.id.startsWith('ficha_grp_') || form.id === 'patient_new')
    && Array.isArray(form.fields) && form.fields.some((f: any) => f.type !== 'heading');
}

/** Selectable options for a walk field (Sí/No for checkbox; field options otherwise). */
function walkOptions(f: BotFormField): Array<{ label: string; value: any }> {
  if (f.type === 'checkbox') return [{ label: 'Sí', value: true }, { label: 'No', value: false }];
  return (f.options || []).map(o => typeof o === 'string'
    ? { label: o, value: o }
    : { label: o.label, value: (o as any).value });
}

/** Ask the current walk field (skipping headings). Submits when none remain. */
async function askWalkField(invokeChat: InvokeChat, chatId: number): Promise<void> {
  const w = formWalks.get(chatId);
  if (!w) return;
  while (w.idx < w.form.fields.length && w.form.fields[w.idx].type === 'heading') w.idx++;
  if (w.idx >= w.form.fields.length) { await submitWalk(invokeChat, chatId); return; }

  const f = w.form.fields[w.idx];
  const askable = w.form.fields.filter(x => x.type !== 'heading');
  const n = askable.length;
  const pos = w.form.fields.slice(0, w.idx).filter(x => x.type !== 'heading').length + 1;
  const actions = (w.form.actions || []).map(a => ({ text: a.label, callback_data: a.send }));

  if (f.type === 'radio' || f.type === 'checkbox') {
    // callback_data carries BOTH the field index and the option index so a
    // tap on a stale keyboard (Telegram never disables old ones) can be
    // matched against the walk's current position and ignored if it's behind.
    const rows = walkOptions(f).map((o, i) => [{ text: o.label, callback_data: `fw:${w.idx}:${i}` }]);
    if (actions.length) rows.push(actions);
    await sendTelegramText(chatId, `(${pos}/${n}) ${f.label}`, { inline_keyboard: rows });
  } else if (f.type === 'image_upload') {
    await sendTelegramText(chatId, `(${pos}/${n}) ${f.label}\nEnviá la(s) imagen(es) como foto.`,
      actions.length ? { inline_keyboard: [actions] } : undefined);
  } else {
    const hint = f.placeholder ? ` (${f.placeholder})` : '';
    await sendTelegramText(chatId, `(${pos}/${n}) ${f.label}${hint}`,
      actions.length ? { inline_keyboard: [actions] } : undefined);
  }
}

/** Record the answer for the current field and advance the walk. */
async function applyWalkAnswer(invokeChat: InvokeChat, chatId: number, value: any): Promise<void> {
  const w = formWalks.get(chatId);
  if (!w) return;
  const f = w.form.fields[w.idx];
  if (f?.key) w.answers[f.key] = value;
  w.idx++;
  await askWalkField(invokeChat, chatId);
}

/** All fields answered: submit the form to the brain and deliver the next step. */
async function submitWalk(invokeChat: InvokeChat, chatId: number): Promise<void> {
  const w = formWalks.get(chatId);
  if (!w) return;
  formWalks.delete(chatId);
  const jwt = chatAuth.get(chatId) || '';
  const headers: Record<string, string> = {};
  if (jwt) headers['authorization'] = `Bearer ${jwt}`;
  const sessionId = chatSessions.get(chatId) || undefined;

  let body: any;
  if (w.form.submit_mode === 'structured') {
    ({ body } = await invokeChat({
      headers,
      body: { form_submission: { form_id: w.form.id, data: w.answers }, session_id: sessionId },
    }));
  } else if (w.form.submit_send) {
    // `||` is the field separator of submit_send commands (e.g. /nuevo-paciente)
    // — scrub it from free-text answers so they can't break the parse.
    const msg = w.form.submit_send.replace(/\{(\w+)\}/g, (_m, k) =>
      String(w.answers[k] ?? '').replace(/\|{2,}/g, ' ').replace(/\s+/g, ' ').trim());
    ({ body } = await invokeChat({ headers, body: { message: msg, session_id: sessionId } }));
  } else {
    const msg = Object.values(w.answers).join(' ').trim() || 'ok';
    ({ body } = await invokeChat({ headers, body: { message: msg, session_id: sessionId } }));
  }
  await deliver(invokeChat, chatId, body);
}

/** Handle a tapped inline button: resolve its `send` payload and route it. */
async function handleCallback(invokeChat: InvokeChat, cq: any): Promise<void> {
  await answerCallback(cq?.id);
  const chatId = cq?.message?.chat?.id;
  if (typeof chatId !== 'number') return;
  const fromId = cq?.from?.id;
  if (typeof fromId !== 'number') return;

  // Identity gate (sets chatAuth for any walk submit triggered below).
  const jwt = await authorizeChat(chatId, fromId);
  if (!jwt) return;
  touch(chatId);
  const data = cq?.data;

  // Mid-walk option tap: `fw:<fieldIdx>:<optIdx>` is the chosen option.
  if (typeof data === 'string' && data.startsWith('fw:')) {
    const w = formWalks.get(chatId);
    // A leftover `fw:*` with no active walk is a stale keyboard — no-op rather
    // than forwarding the literal "fw:0" to the brain as a search.
    if (!w) return;
    const parts = data.split(':');
    // Old single-index form `fw:<i>` (pre-restart buttons) targets the current
    // field; the new form `fw:<fieldIdx>:<optIdx>` must match w.idx or it's a
    // tap on a question already answered — ignore it.
    const fieldIdx = parts.length >= 3 ? parseInt(parts[1], 10) : w.idx;
    const optIdx   = parseInt(parts[parts.length - 1], 10);
    if (fieldIdx !== w.idx) return;
    const value = walkOptions(w.form.fields[w.idx])[optIdx]?.value;
    if (value === undefined) return;            // out-of-range stale option
    await applyWalkAnswer(invokeChat, chatId, value);
    return;
  }
  // Any other button while walking is an action (e.g. "Omitir"): leave the walk
  // and route its send normally.
  if (formWalks.has(chatId)) formWalks.delete(chatId);

  const mapped = callbackSends.get(data);
  // A bare internal id (q<n>) that isn't in the map is a stale button — its
  // mapping was lost (e.g. the bot restarted). Re-show the menu instead of
  // forwarding "q6" to the brain.
  if (mapped === undefined && typeof data === 'string' && /^q[0-9a-z]+$/.test(data)) {
    await sendWelcomeMenu(chatId);
    return;
  }
  const send = mapped || data;
  if (typeof send !== 'string' || !send.trim()) return;
  await routeTurn(invokeChat, chatId, send, jwt, '');
}

/**
 * Register the webhook with Telegram so updates are POSTed to PUBLIC_URL.
 * No-op when TELEGRAM_PUBLIC_URL is unset (manual management). Best-effort.
 */
async function registerWebhook(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const publicUrl = process.env.TELEGRAM_PUBLIC_URL;
  if (!token || !publicUrl) {
    if (!token) console.log('[telegram] no TELEGRAM_BOT_TOKEN → webhook not registered');
    else console.log('[telegram] no TELEGRAM_PUBLIC_URL → manage webhook manually');
    return;
  }
  const url = publicUrl.replace(/\/+$/, '') + WEBHOOK_PATH;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        ...(secret ? { secret_token: secret } : {}),
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      }),
    });
    const data: any = await r.json().catch(() => ({}));
    if (data?.ok) console.log(`[telegram] webhook registered → ${url}`);
    else console.error('[telegram] setWebhook failed:', JSON.stringify(data));
  } catch (e: any) {
    console.error('[telegram] setWebhook error:', e?.message || e);
  }
}

/**
 * Start the Telegram webhook listener. Returns the http.Server so the caller
 * can close it on shutdown.
 */
export function startTelegram(invokeChat: InvokeChat) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req: Request, res: Response) =>
    res.json({ ok: true, service: 'cepi-bot-telegram' }));

  app.post(WEBHOOK_PATH, async (req: Request, res: Response) => {
    // Verify the optional shared secret Telegram echoes back.
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected && req.header('x-telegram-bot-api-secret-token') !== expected) {
      return res.sendStatus(401);
    }
    // Ack immediately so Telegram doesn't retry; process asynchronously.
    res.sendStatus(200);
    try {
      const message = req.body?.message || req.body?.edited_message;
      const callback = req.body?.callback_query;
      // Serialise per chat so updates for one chat can't race each other.
      const chatId = callback?.message?.chat?.id ?? message?.chat?.id;
      if (callback) {
        if (typeof chatId === 'number') {
          await serialize(chatId, () => handleCallback(invokeChat, callback));
        } else {
          await handleCallback(invokeChat, callback).catch(e =>
            console.error('[telegram] callback error:', e?.message || e));
        }
      } else if (message) {
        if (typeof chatId === 'number') {
          await serialize(chatId, () => handleInbound(invokeChat, message));
        } else {
          await handleInbound(invokeChat, message).catch(e =>
            console.error('[telegram] handle error:', e?.message || e));
        }
      }
    } catch (e: any) {
      console.error('[telegram] webhook error:', e?.message || e);
    }
  });

  const port = parseInt(process.env.TELEGRAM_WEBHOOK_PORT || '9998', 10);
  const server = app.listen(port, () => {
    console.log(`💬 cepi-bot Telegram webhook listening on :${port}`);
    void registerWebhook();
  });
  return server;
}
