/**
 * bot_session persistence (PAPER §11.5). Stores conversational state as a
 * regular entity in TodoERP so it gets all the platform features for free
 * (chatter, audit, attachments, future search).
 *
 * The session is keyed by entity id (UUID). The agent reads turns + slots
 * at start of turn and writes back at end of turn. Failures during write
 * do not block the response (logged, retried best-effort).
 *
 * The bot_session entity_definition is seeded by medical-seed/001
 * (entity_id 17000000-0000-0000-0000-000000000000).
 */
import { TodoErpMcpClient, ToolCallResult } from './mcpClient.js';
import { ChatTurn } from './llm.js';

export const BOT_SESSION_ENTITY_ID = '17000000-0000-0000-0000-000000000000';

/** A pending action awaits user confirmation before it persists. */
export interface PendingAction {
  /** Friendly summary shown to the user. */
  summary: string;
  /** MCP tool to invoke on confirm. Omitted when `batch` is used. */
  tool?: string;
  args?: Record<string, unknown>;
  /** What the bot says on success. {{id}} is replaced by the new entity id. */
  successMessage: string;
  /** ISO timestamp; server may expire after some time (not enforced yet). */
  createdAt: string;
  /**
   * Optional multi-step action. When present, the confirmation gate runs
   * every step (each its own tool/args) in sequence instead of `tool`/`args`.
   * Used by the image-upload ficha groups, which create one clinical_image
   * (or consent) record per uploaded attachment.
   */
  batch?: Array<{ tool: string; args: Record<string, unknown> }>;
}

export interface BotSession {
  id: string;
  user_id: string | null;
  active_patient_id: string | null;
  active_episode_id: string | null;
  turns: ChatTurn[];
  extracted_slots: Record<string, unknown>;
  pending_slots: string[];
  tool_calls: Array<{ name: string; args: any; ok: boolean; t: string }>;
  estado: 'abierta' | 'cerrada' | 'abandonada';
  /** R-style confirmation gate: present means "the bot is waiting for sí/no". */
  pending_action: PendingAction | null;
  /**
   * Registro crudo del canal de chat (canalRaw.ts): lo que la persona mandó y
   * lo que el bot escribió, tal cual. No va al LLM ni a la UI; es la fuente
   * para reprocesar la sesión contra lo que quedó en la ficha.
   */
  canal_raw: unknown[];
}

export function emptySession(userId: string | null = null): Omit<BotSession, 'id'> {
  return {
    user_id: userId,
    active_patient_id: null,
    active_episode_id: null,
    turns: [],
    extracted_slots: {},
    pending_slots: [],
    tool_calls: [],
    estado: 'abierta',
    pending_action: null,
    canal_raw: [],
  };
}

/** Convert an in-memory session into the JSONB shape declared by the
 *  bot_session entity_definition (textarea fields hold serialized JSON). */
function toPersistedShape(s: Omit<BotSession, 'id'>): Record<string, unknown> {
  // Stamp any turn that lacks a timestamp / episode (non-mutating: maps a copy
  // so the in-memory turns are untouched). `ts` enables chronological ordering;
  // `episode_id` (the active episode AT SAVE TIME) lets the UI group the thread
  // per episode even when one session spans several episodes (nueva consulta).
  const now = new Date().toISOString();
  const ep = s.active_episode_id ?? '';
  const stampedTurns = (s.turns ?? []).map(t => {
    if (t.ts && t.episode_id !== undefined) return t;
    return { ...t, ts: t.ts || now, episode_id: t.episode_id !== undefined ? t.episode_id : (ep || null) };
  });
  return {
    user_id:           s.user_id ?? '',
    active_patient_id: s.active_patient_id ?? '',
    active_episode_id: s.active_episode_id ?? '',
    turns:             JSON.stringify(stampedTurns),
    extracted_slots:   JSON.stringify(s.extracted_slots ?? {}),
    pending_slots:     JSON.stringify(s.pending_slots ?? []),
    tool_calls:        JSON.stringify(s.tool_calls ?? []),
    estado:            s.estado,
    pending_action:    JSON.stringify(s.pending_action ?? null),
    canal_raw:         JSON.stringify(s.canal_raw ?? []),
  };
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return (raw as T) ?? fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function createSession(
  mcp: TodoErpMcpClient,
  userId: string | null
): Promise<BotSession> {
  const data = emptySession(userId);
  const r: ToolCallResult = await mcp.call('entities.create', {
    record_type: 'business',
    entity_id: BOT_SESSION_ENTITY_ID,
    title: `bot_session_${new Date().toISOString()}`,
    data: toPersistedShape(data),
  });
  if (!r.ok) throw new Error(`createSession failed: ${r.error}`);
  return { id: r.data.id, ...data };
}

export async function loadSession(
  mcp: TodoErpMcpClient,
  sessionId: string
): Promise<BotSession | null> {
  const r: ToolCallResult = await mcp.call('entities.get', { id: sessionId });
  if (!r.ok || !r.data) return null;
  const d = r.data.data || {};
  return {
    id: r.data.id,
    user_id:           d.user_id || null,
    active_patient_id: d.active_patient_id || null,
    active_episode_id: d.active_episode_id || null,
    turns:             safeParseJson<ChatTurn[]>(d.turns, []),
    extracted_slots:   safeParseJson<Record<string, unknown>>(d.extracted_slots, {}),
    pending_slots:     safeParseJson<string[]>(d.pending_slots, []),
    tool_calls:        safeParseJson<BotSession['tool_calls']>(d.tool_calls, []),
    estado:            (d.estado as BotSession['estado']) || 'abierta',
    pending_action:    safeParseJson<BotSession['pending_action']>(d.pending_action, null),
    canal_raw:         safeParseJson<unknown[]>(d.canal_raw, []),
  };
}

export async function saveSession(mcp: TodoErpMcpClient, session: BotSession): Promise<void> {
  const { id, ...rest } = session;
  const r = await mcp.call('entities.update', {
    id,
    record_type: 'business',
    data: toPersistedShape(rest),
  });
  if (!r.ok) {
    console.warn(`[sessionStore] save failed for ${id}: ${r.error}`);
  }
}
