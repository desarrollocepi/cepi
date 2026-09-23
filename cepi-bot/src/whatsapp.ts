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
 *   WHATSAPP_BOT_EMAIL / WHATSAPP_BOT_PASSWORD   admin service account, used
 *                           ONLY to resolve a phone to its TodoERP user
 *                           (falls back to TELEGRAM_BOT_*, same account)
 *
 * Auth model (same as the Telegram adapter): every inbound phone is resolved
 * through /api/auth/external/resolve to the user whose users.data.whatsapp_phone
 * matches it, and the turn runs AS that user, with their own role/permissions.
 * A phone linked to nobody gets a "not registered" reply and never reaches the
 * brain — the number is public, so anyone can write to it. Each phone number is
 * mapped to one persisted bot_session, kept in memory here.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Request, Response } from 'express';
import type { BotForm, BotFormField, QuickReply } from './flowV1.js';

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
  | { ok: true; jwt: string }
  | { ok: false; reason: 'unregistered' | 'error' };

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
async function resolveUserAuth(from: string): Promise<ResolveResult> {
  const adminJwt = await getServiceJwt();
  if (!adminJwt) {
    console.error('[whatsapp] no service account configured to resolve identity');
    return { ok: false, reason: 'error' };
  }
  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  try {
    for (const externalId of phoneCandidates(from)) {
      const r = await fetch(`${base}/api/auth/external/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ platform: 'whatsapp', external_id: externalId }),
      });
      if (r.status === 404) continue;
      if (!r.ok) { console.error('[whatsapp] resolve failed', r.status); return { ok: false, reason: 'error' }; }
      const data: any = await r.json().catch(() => ({}));
      return data?.token ? { ok: true, jwt: data.token } : { ok: false, reason: 'error' };
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

/** Process one inbound message object from the webhook payload. */
async function handleInbound(invokeChat: InvokeChat, msg: any): Promise<void> {
  const from = msg?.from;
  if (!from) return;
  // Only plain text is routed for now (images/audio would map to attachments).
  const text = msg?.text?.body;
  if (typeof text !== 'string' || !text.trim()) {
    await sendWhatsappText(from, 'Por ahora solo proceso mensajes de texto.');
    return;
  }

  // Identity gate: the turn runs AS the user linked to this phone, or not at all.
  const auth = await resolveUserAuth(from);
  if (!auth.ok) {
    await sendWhatsappText(from, auth.reason === 'unregistered'
      ? `🔒 Este número no está registrado para usar el asistente de CEPI.\n\n` +
        `Tu número es +${from}. Pásaselo al administrador para que te dé acceso.`
      : 'No pude validar tu identidad ahora mismo. Prueba de nuevo en un rato.');
    return;
  }
  const sessionId = phoneSessions.get(from) || undefined;

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
          for (const msg of messages) {
            await handleInbound(invokeChat, msg).catch(e =>
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
