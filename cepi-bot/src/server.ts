/**
 * cepi-bot HTTP server. Wraps the agent loop behind a minimal REST API
 * the medical frontend (Fase 5+) can call.
 *
 * Endpoints:
 *   POST /api/bot/chat
 *     body: { history: ChatTurn[], jwt?, apiKey?, mode? }
 *     resp: { text, history, toolCalls }
 *
 *   GET /health
 *     resp: { ok, service, mcpEntry }
 *
 * Auth model: the frontend forwards the user's TodoERP JWT in
 * Authorization: Bearer ... (or x-api-key); the bot uses it on every
 * MCP call so all permission checks happen as that user.
 *
 * Future (Fase 5+): SSE streaming, role-based dispatcher (guest path
 * keeps current legacy behavior, others route through the agent).
 */
import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { runAgentTurn } from './agent.js';
import { ChatTurn } from './llm.js';
import { TodoErpMcpClient } from './mcpClient.js';
import { createSession, loadSession, saveSession, BOT_SESSION_ENTITY_ID, BotSession } from './sessionStore.js';
import {
  handleV1Flow, fichaGroupFormFilled, firstIncompleteFichaGroup, fichaCompleta, recalcularCompletitud, guardarGrupoFicha, guardarFichaCompleta,
  nextIncompleteFichaGroupId, fichaGroupIsComplete, fichaBookmarks, BotForm,
  FICHA_GROUPS,
} from './flowV1.js';
import { extraerEpisodio } from './extraerFicha.js';
import { icdSearch } from './icdWho.js';
import { extractPendingQuestions, pendingQuestionsNote } from './pendingQuestions.js';
import { listEpisodeImagesWithClassifications, CLINICAL_IMAGE_ENTITY_ID, HAM_TO_ICD } from './episodeImages.js';
import { erpClient } from './erp.js';
import { listarGaleria } from './galeria.js';
import { startWhatsapp } from './whatsapp.js';
import { startTelegram } from './telegram.js';

dotenv.config();

// Los secretos de producción NO se leen de disco: los inyecta `dotrino-env run --ns
// <cajón>` en el entorno del proceso, antes de que node arranque (ver ecosystem /
// PM2). Se hace así y no con `import '@dotrino/vault/config'` porque ese camino
// necesita top-level await, y bajo el loader `ts-node/esm` que corre este servicio
// el TLA revienta con un `[Object: null prototype] {}` sin traza — comprobado en la
// instancia de producción con un archivo de tres líneas.
//
// Consecuencia a tener presente: como llegan por entorno, `dotenv.config()` NO los
// pisa (dotenv no sobrescribe variables ya definidas).

const PATIENT_ENTITY_ID = '11000000-0000-0000-0000-000000000000';
const EPISODE_ENTITY_ID = '12000000-0000-0000-0000-000000000000';

/**
 * Open a new episode for the active patient and return its id. The episode
 * is the container the ficha clínica sections then fill in via entities.update.
 */
async function openEpisodeFicha(
  mcp: TodoErpMcpClient, _session: BotSession, patientId: string,
): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  let medicoId: string | null = null;
  try {
    const me = await mcp.call('auth.whoami', {});
    medicoId = ((me as any)?.data?.user?.id as string) || null;
  } catch { /* leave null */ }
  const res = await mcp.call('entities.create', {
    record_type: 'business',
    entity_id: EPISODE_ENTITY_ID,
    title: `episode_${today}`,
    data: {
      [`${PATIENT_ENTITY_ID}:patient_id`]: patientId,
      medico_id: medicoId,
      fecha: today,
      tipo: 'presencial',
      estado: 'en_curso',
    },
  });
  return (res as any)?.ok ? (((res as any).data?.id as string) || null) : null;
}

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'cepi-bot', port: PORT, ts: new Date().toISOString() });
});

/**
 * /api/bot/sessions — list the caller's saved sessions, most recent first.
 * Used by the frontend sidebar to switch between past conversations.
 */
app.get('/api/bot/sessions', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    let userId: string | null = null;
    if (jwt) {
      try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
        userId = payload?.sub || null;
      } catch {}
    }

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const r = await mcp.call('entities.list', { type: BOT_SESSION_ENTITY_ID, limit: 200 });
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error || 'list failed' });

    const rows: any[] = Array.isArray(r.data?.data) ? r.data.data
                       : Array.isArray(r.data) ? r.data : [];
    // Optional ?patient_id= filter: the frontend uses it to show all the chats
    // of one patient (single-chat-per-patient with session navigation).
    const patientId = String(req.query.patient_id || '').trim();
    const items = rows
      .filter(row => !userId || (row?.data?.user_id ?? '') === userId)
      .filter(row => !patientId || (row?.data?.active_patient_id ?? '') === patientId)
      .map(row => {
        const turnsRaw = row?.data?.turns;
        let preview = '';
        try {
          const turns = typeof turnsRaw === 'string' ? JSON.parse(turnsRaw) : (turnsRaw || []);
          const lastUserTurn = [...turns].reverse().find((t: any) => t?.role === 'user');
          preview = (lastUserTurn?.content || '').slice(0, 80);
        } catch {}
        // Patient name from the persisted context, so the session pill can
        // show who the chat is about.
        let patientName = '';
        try {
          const slotsRaw = row?.data?.extracted_slots;
          const slots = typeof slotsRaw === 'string' ? JSON.parse(slotsRaw) : (slotsRaw || {});
          const pc = slots?.patient_context;
          if (pc) patientName = [pc.nombre, pc.apellidos].filter(Boolean).join(' ');
        } catch {}
        return {
          id:         row.id,
          title:      row.title || '',
          created_at: row.created_at,
          updated_at: row.updated_at,
          estado:     row?.data?.estado || 'abierta',
          active_patient_id: row?.data?.active_patient_id || null,
          preview,
          patient_name: patientName,
        };
      })
      .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));

    res.json({ ok: true, sessions: items });
  } catch (err) { next(err); }
  finally {
    if (mcp) await mcp.close().catch(() => {});
  }
});

/**
 * /api/bot/session/:id — hydrate a saved session so the frontend can resume
 * after a page refresh without losing the transcript.
 */
app.get('/api/bot/session/:id', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const s = await loadSession(mcp, String(req.params.id));
    if (!s) return res.status(404).json({ ok: false, error: 'Session not found' });

    // Resume the persisted form, but re-evaluate ficha groups: a field shared
    // across sessions (e.g. fecha de nacimiento on the patient) may have been
    // filled elsewhere since this form was staged. If so, auto-skip it.
    let form: BotForm | null = (s.extracted_slots as any)?.active_form ?? null;
    const isFicha = (s.extracted_slots as any)?.form_state?.kind === 'ficha';
    if (isFicha && form && typeof form.id === 'string' && form.id.startsWith('ficha_grp_')) {
      const gid = form.id.slice('ficha_grp_'.length);
      if (await fichaGroupIsComplete(gid, mcp, s)) {
        const nid = await nextIncompleteFichaGroupId(gid, mcp, s);
        form = nid ? await fichaGroupFormFilled(nid, mcp, s) : null;
        s.extracted_slots = {
          ...(s.extracted_slots || {}),
          active_form: form,
          ...(nid ? { ficha_current: nid } : {}),
        };
        await saveSession(mcp, s);
      } else {
        // Refresh the form's pre-filled values from the current DB state.
        form = (await fichaGroupFormFilled(gid, mcp, s)) ?? form;
      }
    }

    res.json({
      ok: true,
      session_id: s.id,
      history: s.turns,
      active_patient_id: s.active_patient_id,
      active_episode_id: s.active_episode_id,
      pending_action: s.pending_action,
      form,
      bookmarks: isFicha ? await fichaBookmarks(mcp, s) : [],
    });
  } catch (err) { next(err); }
  finally {
    if (mcp) await mcp.close().catch(() => {});
  }
});

/**
 * /api/bot/icd/search?q=… — proxy to the WHO ICD-11 MMS search.
 * The OAuth2 token + client_secret stay server-side.
 */
app.get('/api/bot/icd/search', async (req: Request, res: Response) => {
  try {
    const results = await icdSearch(String(req.query.q || ''));
    res.json({ ok: true, results });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message || 'ICD search failed' });
  }
});

/**
 * /api/bot/capabilities — debug helper. Spawns an MCP client with the
 * caller's identity, lists tools, and reports the LLM provider in use.
 */
app.get('/api/bot/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const tools = await mcp.listTools();

    res.json({
      ok: true,
      llm_provider: process.env.CEPI_LLM_PROVIDER || 'stub',
      todoerp_url:  process.env.TODOERP_API_URL  || 'http://localhost:3001',
      tools: tools.map(t => ({ name: t.name, description: t.description })),
    });
  } catch (err) { next(err); }
  finally {
    if (mcp) await mcp.close().catch(() => {});
  }
});

/**
 * /api/bot/episode-images?episode_id=<uuid> — list the clinical images of an
 * episode plus, for each, its AI classifications. Read-only; used by the
 * frontend image gallery. Auth via Bearer JWT or x-api-key, like the other
 * /api/bot GET endpoints.
 */
app.get('/api/bot/episode-images', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    const episodeId = String(req.query.episode_id || '').trim();
    if (!episodeId) return res.status(400).json({ ok: false, error: 'episode_id required' });

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const images = await listEpisodeImagesWithClassifications(mcp, episodeId);
    res.json({ ok: true, images });
  } catch (err) { next(err); }
  finally {
    if (mcp) await mcp.close().catch(() => {});
  }
});

/**
 * /api/bot/galeria?q=&patient_id=&limit=&offset= — las imágenes clínicas de la
 * organización activa (PAPER §24.2.1, D-Aux-22): la galería general con buscador y
 * las de un paciente, de todas sus consultas.
 *
 * `q` busca por nombre del paciente, cédula, diagnóstico, CIE-10 y fecha; sin `q`
 * ni `patient_id`, las más recientes primero. Paginado real: `limit` (60 por
 * defecto, tope 200), `offset` y `total`. Read-only, con el JWT del caller — el
 * alcance por organización lo pone TodoERP (D-Aux-21), no esta capa.
 */
app.get('/api/bot/galeria', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    // Sin el respaldo de CEPI_GUEST_API_KEY, a diferencia del chat: la clave de invitado
    // no tiene org activa, y con ella la galería listaría imágenes de cualquier
    // organización. Acá se entra con la identidad de quien pregunta o no se entra.
    const apiKey = req.header('x-api-key') || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    const r = await listarGaleria(erpClient({ jwt, apiKey }), {
      q: String(req.query.q || ''),
      patientId: String(req.query.patient_id || '').trim() || undefined,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
    });
    res.json({ ok: true, data: r.data, total: r.total });
  } catch (err: any) {
    // Un 401/403 del ERP es del caller, no del bot: se reenvía tal cual.
    if (err?.status === 401 || err?.status === 403) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    next(err);
  }
});

/**
 * /api/bot/ficha?episode_id=<uuid>&patient_id=<uuid> — la ficha completa de un caso:
 * los grupos en orden, cada uno con su formulario prellenado y si tiene dato.
 *
 * Read-only y SIN sesión de chat: es lo que consume el portal de revisión, donde el
 * médico abre un caso para leerlo y ver qué falta, no para llenarlo. Auth por Bearer
 * JWT o x-api-key, como el resto de los GET de /api/bot.
 */
app.get('/api/bot/ficha', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    const episodeId = String(req.query.episode_id || '').trim() || null;
    const patientId = String(req.query.patient_id || '').trim() || null;
    if (!episodeId && !patientId) {
      return res.status(400).json({ ok: false, error: 'episode_id o patient_id required' });
    }

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const ficha = await fichaCompleta(mcp, { patientId, episodeId });
    res.json({ ok: true, episode_id: episodeId, patient_id: patientId, ...ficha });
  } catch (err) { next(err); }
  finally {
    if (mcp) await mcp.close().catch(() => {});
  }
});

/**
 * /api/bot/ficha/grupo — guarda UN grupo de la ficha desde el portal de casos.
 * Body: {group_id, data, episode_id?, patient_id?}
 *
 * Sin sesión de chat. Usa el mismo camino de guardado que el flujo conversacional
 * (`guardarGrupoFicha` → `prepararDatosGrupo` + `coercePatch`), así que las coerciones
 * y los campos derivados (gravedad_total, BLINK) salen iguales de los dos lados.
 */
app.post('/api/bot/ficha/grupo', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    const { group_id, data, episode_id, patient_id } = req.body || {};
    if (!group_id) return res.status(400).json({ ok: false, error: 'group_id required' });
    if (!data || typeof data !== 'object') return res.status(400).json({ ok: false, error: 'data required' });

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const r = await guardarGrupoFicha(mcp, {
      groupId: String(group_id), data,
      patientId: patient_id ? String(patient_id) : null,
      episodeId: episode_id ? String(episode_id) : null,
    });
    res.json(r);
  } catch (err: any) {
    // Un payload inválido es culpa del cliente, no del servidor: 400, no 500.
    const msg = String(err?.message || err);
    if (/desconocido|falta |ningún campo|se completa subiendo/i.test(msg)) {
      return res.status(400).json({ ok: false, error: msg });
    }
    next(err);
  }
  finally { if (mcp) await mcp.close().catch(() => {}); }
});

/**
 * /api/bot/ficha/guardar — guarda la ficha ENTERA desde un formato documental.
 * Body: {episode_id?, patient_id?, data}
 *
 * Es el destino del botón «Guardar» del visor de formatos del portal. A diferencia
 * de /ficha/grupo, que recibe un grupo y valida contra sus campos declarados, acá
 * llega el documento completo y el reparto lo hace `guardarFichaCompleta`: §1-§2 al
 * paciente, §3 en adelante al episodio, descartando lo que no sea campo de la ficha
 * y sin dejar que un vacío borre lo guardado.
 */
app.post('/api/bot/ficha/guardar', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    const { data, episode_id, patient_id } = req.body || {};
    if (!data || typeof data !== 'object') return res.status(400).json({ ok: false, error: 'data required' });
    if (!episode_id && !patient_id) {
      return res.status(400).json({ ok: false, error: 'episode_id o patient_id required' });
    }

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const r = await guardarFichaCompleta(mcp, {
      patientId: patient_id ? String(patient_id) : null,
      episodeId: episode_id ? String(episode_id) : null,
    }, data as Record<string, unknown>);
    res.json(r);
  } catch (err: any) { next(err); }
  finally { if (mcp) await mcp.close().catch(() => {}); }
});

/**
 * /api/bot/ficha/extraer — rellena campos vacíos leyendo el texto libre del crudo.
 * Body: {episode_id} o {episode_ids: [...]} para un lote.
 *
 * No consulta a DrPro: trabaja sobre `drpro_raw`, que es inmutable y ya está en la
 * base. Por eso se puede reescribir el prompt y volver a pasarlo cuantas veces haga
 * falta. Nunca pisa un campo con valor, y marca en `ficha_fuente` lo que escribió.
 */
app.post('/api/bot/ficha/extraer', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    const uno = req.body?.episode_id ? [String(req.body.episode_id)] : null;
    const varios = Array.isArray(req.body?.episode_ids) ? req.body.episode_ids.map(String) : null;
    const ids = uno || varios;
    if (!ids?.length) return res.status(400).json({ ok: false, error: 'episode_id o episode_ids required' });
    // Tope por petición: cada episodio es una llamada al LLM, y un lote sin límite
    // dejaría al bot minutos sin atender a nadie más.
    if (ids.length > 50) return res.status(400).json({ ok: false, error: 'máximo 50 episodios por petición' });

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();
    const soloVacios = req.body?.solo_vacios !== false;
    const resultados = [];
    for (const id of ids) {
      try { resultados.push(await extraerEpisodio(mcp, id, { soloVacios })); }
      catch (err: any) { resultados.push({ episode_id: id, ok: false, escritos: [], omitidos_por_ocupado: [], motivo: String(err?.message || err) }); }
    }
    res.json({ ok: true, total: resultados.length, resultados });
  } catch (err: any) { next(err); }
  finally { if (mcp) await mcp.close().catch(() => {}); }
});

/**
 * /api/bot/ficha/recalcular — recalcula y GUARDA el % de llenado de un episodio.
 * Body: {episode_id, patient_id?} o {episode_ids: [...]} para un lote (backfill).
 *
 * Escribe en el episodio para que el portal pueda BUSCAR por deuda de datos con un
 * filtro SQL en vez de abrir ficha por ficha (PAPER §22.2).
 */
app.post('/api/bot/ficha/recalcular', async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const auth = req.header('authorization') || '';
    const jwt    = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const apiKey = req.header('x-api-key') || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) return res.status(401).json({ ok: false, error: 'Auth required' });

    const body = req.body || {};
    const ids: string[] = Array.isArray(body.episode_ids) && body.episode_ids.length
      ? body.episode_ids.map(String)
      : (body.episode_id ? [String(body.episode_id)] : []);
    if (!ids.length) return res.status(400).json({ ok: false, error: 'episode_id o episode_ids required' });

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();

    const resultados: any[] = [];
    for (const episodeId of ids) {
      try {
        // El paciente sale del propio episodio: los grupos §1-§2 viven en él y sin
        // resolverlo la ficha se leería a medias.
        let patientId: string | null = body.patient_id ? String(body.patient_id) : null;
        if (!patientId) {
          const ep: any = await mcp.call('entities.get', { id: episodeId });
          const d = ep?.data?.data || {};
          const rel = d['11000000-0000-0000-0000-000000000000:patient_id'];
          patientId = (typeof rel === 'string' ? rel : (Array.isArray(rel) ? rel[0]?.id : rel?.id)) || ep?.data?.patient_id || null;
        }
        const r = await recalcularCompletitud(mcp, { episodeId, patientId });
        resultados.push({ episode_id: episodeId, ...r });
      } catch (err: any) {
        resultados.push({ episode_id: episodeId, error: String(err?.message || err) });
      }
    }
    res.json({ ok: true, total: resultados.length, resultados });
  } catch (err) { next(err); }
  finally { if (mcp) await mcp.close().catch(() => {}); }
});

/**
 * One-line status used by non-UI channels (e.g. Telegram) as the first line of
 * every reply: the active patient's name, or — when there's no patient — a
 * human-readable description of the chat state. Derived from the session's
 * extracted_slots; returns '' when there's no session.
 */
function computeStatusHeader(session: BotSession | null): string {
  if (!session) return '';
  const slots: any = session.extracted_slots || {};
  const pc = slots.patient_context;
  if (session.active_patient_id && pc) {
    const name = [pc.nombre, pc.apellidos].filter(Boolean).join(' ').trim()
      || session.active_patient_id.slice(0, 8);
    if (slots.mode === 'patient_info') return `👤 ${name} (consulta de información)`;
    if (slots.form_state?.kind === 'ficha') {
      const g = FICHA_GROUPS.find(x => x.id === slots.ficha_current);
      return g ? `👤 ${name} — ficha §${g.label}` : `👤 ${name} — ficha`;
    }
    return `👤 ${name}`;
  }
  // No active patient → describe the chat state.
  const formTitle: string = slots.active_form?.title || '';
  if (/buscar paciente/i.test(formTitle)) return '📋 Buscando paciente';
  if (/nuevo paciente/i.test(formTitle)) return '📋 Creando paciente';
  if (slots.mode === 'general') return '📋 Modo general (sin paciente)';
  return '📋 Sin paciente activo';
}

/**
 * Confirmation gate toggle. Historically every agent-inferred sensitive write
 * was staged into `session.pending_action` and required a sí/no from the user
 * (PAPER §13.3.1). That gate is now OFF by default: inferred writes execute
 * immediately. The real concern is *showing* sensitive data, which is handled
 * by the PII redaction layer (redact.ts), not by gating writes. Set
 * CEPI_CONFIRM_GATE=1 to bring the old sí/no gate back.
 */
const CONFIRM_GATE_ENABLED = process.env.CEPI_CONFIRM_GATE === '1';

/** Consent entity (PAPER §8 image-consent records). Mirrors flowV1's constant. */
const CONSENT_ENTITY_ID = '18000000-0000-0000-0000-000000000000';

/**
 * Execute the session's staged `pending_action` now (the work the old "sí"
 * confirmation used to do): run the tool call(s), write the chatter audit note,
 * auto-activate newly created patient/episode entities, clear the action, and
 * return the response payload to send. Shared by the explicit confirm path and
 * by the auto-confirm that fires when the gate is disabled.
 */
async function executePendingActionResult(
  session: BotSession, mcp: TodoErpMcpClient, message: string, sessionId: string | null,
): Promise<any> {
  const pa = session.pending_action as any;

  // Multi-step (batch) pending action — run every step in order.
  if (Array.isArray(pa.batch) && pa.batch.length) {
    const ids: string[] = [];
    const errs: string[] = [];
    const batchCalls: any[] = [];
    for (const step of pa.batch) {
      const r = await mcp.call(step.tool, step.args);
      batchCalls.push({ name: step.tool, args: step.args, result: r });
      if ((r as any)?.ok) {
        const nid = (r as any)?.data?.id || '';
        if (nid) {
          ids.push(nid);
          await mcp.call('chatter.add_note', {
            entity_id: nid,
            body: `🤖 Acción ejecutada por el agente: \`${step.tool}\` — ${pa.summary}`,
          }).catch(() => {});
        }
      } else {
        errs.push((r as any)?.error || 'error');
      }
    }
    const ackText = errs.length
      ? `${pa.successMessage.replace(/\{\{count\}\}/g, String(ids.length))}` +
        ` (con ${errs.length} error(es): ${errs.join('; ')})`
      : pa.successMessage.replace(/\{\{count\}\}/g, String(ids.length));
    session.pending_action = null;
    session.turns = [
      ...session.turns,
      { role: 'user',      content: message },
      { role: 'assistant', content: ackText },
    ];
    await saveSession(mcp, session);
    return {
      ok: true, session_id: sessionId, text: ackText,
      history: session.turns, toolCalls: batchCalls,
      active_patient_id: session.active_patient_id,
      active_episode_id: session.active_episode_id,
      bookmarks: ((session.extracted_slots as any)?.form_state?.kind === 'ficha')
        ? await fichaBookmarks(mcp, session) : undefined,
    };
  }

  // Single-action path (the `batch` case returned above, so tool/args exist).
  const paTool = String(pa.tool);
  const paArgs = (pa.args || {}) as Record<string, any>;
  const result = await mcp.call(paTool, paArgs);
  const newId  = result.ok ? (result.data?.id || '') : '';
  const ackText = result.ok
    ? pa.successMessage.replace(/\{\{id\}\}/g, newId)
    : `No pude completar la acción: ${result.error}`;

  // PAPER §13.3 — audit: every successful tool call leaves a chatter note.
  if (result.ok) {
    const targetForNote =
      (paTool === 'entities.create' && newId) ? newId :
      (paTool === 'entities.update' && paArgs?.id) ? paArgs.id :
      (paTool === 'entities.request_review' && paArgs?.entity_id) ? paArgs.entity_id :
      null;
    if (targetForNote) {
      await mcp.call('chatter.add_note', {
        entity_id: targetForNote,
        body: `🤖 Acción ejecutada por el agente: \`${paTool}\` — ${pa.summary}`,
      }).catch(() => {});
    }
  }

  // Auto-activate newly created clinical entities so the user can keep working.
  let extraForm: BotForm | null = null;
  if (result.ok && paTool === 'entities.create' && newId) {
    const createdType = paArgs?.entity_id;
    if (createdType === '11000000-0000-0000-0000-000000000000') {
      session.active_patient_id = newId;
      if ((session.extracted_slots as any)?.mode !== 'patient_info') {
        const episodeId = await openEpisodeFicha(mcp, session, newId);
        session.active_episode_id = episodeId;
        const firstGroup = await firstIncompleteFichaGroup(mcp, session);
        extraForm = firstGroup
          ? await fichaGroupFormFilled(firstGroup, mcp, session)
          : null;
        session.extracted_slots = {
          ...(session.extracted_slots || {}),
          mode: 'patient',
          form_state: { kind: 'ficha' },
          ficha_done: [],
          ...(firstGroup ? { ficha_current: firstGroup } : {}),
          active_form: extraForm,
        };
      } else {
        // patient_info (non-presential): no ficha is opened, but the
        // patient_new form that triggered this create is still persisted as
        // active_form. Clear it — otherwise every later reply re-attaches it
        // (server echoes the persisted form on any response that lacks one),
        // and adapters that walk patient_new (Telegram) would restart the
        // walk on each turn. extraForm stays null.
        session.extracted_slots = {
          ...(session.extracted_slots || {}),
          active_form: null,
        };
      }
    } else if (createdType === '12000000-0000-0000-0000-000000000000') {
      session.active_episode_id = newId;
    }
  }
  session.pending_action = null;
  session.turns = [
    ...session.turns,
    { role: 'user',      content: message },
    { role: 'assistant', content: ackText },
  ];
  await saveSession(mcp, session);
  return {
    ok: true, session_id: sessionId, text: ackText,
    history: session.turns,
    toolCalls: [{ name: pa.tool, args: pa.args, result }],
    active_patient_id: session.active_patient_id,
    active_episode_id: session.active_episode_id,
    form: extraForm,
    bookmarks: ((session.extracted_slots as any)?.form_state?.kind === 'ficha')
      ? await fichaBookmarks(mcp, session) : undefined,
  };
}

const chatHandler = async (req: Request, res: Response, next: NextFunction) => {
  let mcp: TodoErpMcpClient | null = null;
  try {
    const {
      history,
      jwt: jwtFromBody,
      apiKey: keyFromBody,
      session_id: incomingSessionId,
      message = '',
      form_submission: formSubmission,
    } = req.body || {};

    const auth = req.header('authorization') || '';
    const headerJwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const headerKey = req.header('x-api-key') || '';

    const jwt    = jwtFromBody || headerJwt || '';
    const apiKey = keyFromBody || headerKey || process.env.CEPI_GUEST_API_KEY || '';
    if (!jwt && !apiKey) {
      return res.status(401).json({ ok: false, error: 'Missing JWT or API key (and no CEPI_GUEST_API_KEY configured)' });
    }

    // Enrich every JSON reply with `status_header` (active patient name / chat
    // state) for non-UI channels, computed from the live in-memory session.
    // Done once here so the handler's many early `res.json(...)` returns all
    // get it without duplicating the logic at each return site.
    let sessionForHeader: BotSession | null = null;
    const _json = res.json.bind(res);
    (res as any).json = (payload: any) => {
      if (payload && typeof payload === 'object'
          && payload.status_header === undefined && payload.session_id) {
        payload.status_header = computeStatusHeader(sessionForHeader);
      }
      return _json(payload);
    };

    // Two input modes:
    //   - history:  full transcript (caller manages state itself)
    //   - session_id + message: server loads session, appends, persists
    let inputHistory: ChatTurn[];
    let sessionId: string | null = null;

    mcp = new TodoErpMcpClient({ jwt, apiKey });
    await mcp.connect();

    let activePatientId: string | null = null;
    let activeEpisodeId: string | null = null;

    if ((typeof message === 'string' && message.length > 0) || formSubmission) {
      // Session-managed path.
      let session = incomingSessionId ? await loadSession(mcp, incomingSessionId) : null;
      if (!session) {
        const me = await mcp.call('auth.whoami', {});
        const userId = (me.data?.user?.id as string) || null;
        session = await createSession(mcp, userId);
      }
      sessionId = session.id;
      sessionForHeader = session;   // mutated in place by the flow below

      // ── slash-style state commands handled server-side, no LLM needed ──
      const trimmed = message.trim();
      const setPatient = trimmed.match(/^\/?\s*activar\s+paciente\s+([0-9a-f-]{36})\s*$/i);
      const clrPatient = trimmed.match(/^\/?\s*(salir|cerrar|olvidar)\s+paciente\s*$/i);
      const setEpisode = trimmed.match(/^\/?\s*activar\s+episodio\s+([0-9a-f-]{36})\s*$/i);
      // NB: "cerrar episodio" is NOT an unlink — it CLOSES the episode (estado
      // cerrado) and is handled (with authorization) by the closeMatch branch
      // below. Only "salir/olvidar episodio" merely detaches the active pointer.
      const clrEpisode = trimmed.match(/^\/?\s*(salir|olvidar)\s+episodio\s*$/i);

      if (setPatient) {
        const pid = setPatient[1];
        session.active_patient_id = pid;

        // Pull the patient record so the bot has the data in context and can
        // greet with basic info (name, age, sex, weight…) instead of a bare id.
        let patientData: Record<string, any> = {};
        let patientTitle = pid;
        try {
          const pr = await mcp.call('entities.get', { id: pid });
          const rec = (pr as any)?.data || {};
          patientData = rec.data || {};
          patientTitle = rec.title || pid;
        } catch { /* fall back to the id */ }

        const nombre = [patientData.nombre, patientData.apellidos]
          .filter(Boolean).join(' ') || patientTitle;
        const edad = (() => {
          const dob = patientData.fecha_nac;
          if (!dob) return null;
          const d = new Date(dob);
          if (isNaN(d.getTime())) return null;
          const now = new Date();
          let a = now.getFullYear() - d.getFullYear();
          const m = now.getMonth() - d.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
          return a >= 0 && a < 150 ? a : null;
        })();
        const info = [
          edad != null ? `${edad} años` : null,
          patientData.sexo ? `sexo ${patientData.sexo}` : null,
          patientData.peso ? `${patientData.peso} kg` : null,
          patientData.cedula ? `cédula ${patientData.cedula}` : null,
          patientData.tipo_sangre ? `grupo ${patientData.tipo_sangre}` : null,
        ].filter(Boolean);

        // Most recent prior episode, summarised in one line for context.
        let prevLine = '';
        let lastEpisodeId: string | null = null;
        let openEpisodeId: string | null = null;
        try {
          const er = await mcp.call('entities.list', {
            type: '12000000-0000-0000-0000-000000000000',
            filter: { patient_id: pid },
            limit: 50,
          });
          const eps = Array.isArray((er as any)?.data) ? (er as any).data : [];
          if (eps.length) {
            eps.sort((a: any, b: any) =>
              String(b?.data?.fecha || '').localeCompare(String(a?.data?.fecha || '')));
            const last = eps[0];
            lastEpisodeId = (last?.id as string) || null;
            const motivo = last?.data?.motivo_consulta;
            if (motivo) {
              prevLine = `Consulta anterior (${last?.data?.fecha || 's/f'}): ${motivo}.`;
            }
            // The "current" consultation is the most recent episode still open
            // (estado !== 'cerrado'). A patient has at most one open at a time;
            // it stays current until it's closed, so we resume it instead of
            // asking "¿nueva o anterior?".
            const openEp = eps.find((e: any) => (e?.data?.estado || 'en_curso') !== 'cerrado');
            openEpisodeId = (openEp?.id as string) || null;
          }
        } catch { /* no prior episode context */ }

        // "patient_info" is a non-presential lookup: show the data and stop.
        // "patient" (atención) assumes the patient is being attended, so the
        // bot opens a new episode and starts the ficha clínica.
        const infoOnly = (session.extracted_slots as any)?.mode === 'patient_info';
        const greet =
          `Paciente activo: ${nombre}` +
          (info.length ? `\n  ${info.join(' · ')}` : '') +
          (prevLine ? `\n  ${prevLine}` : '');

        if (infoOnly) {
          // Non-presential lookup: link the session to the patient's most
          // recent episode so "Mostrar ficha" opens that consultation.
          session.active_episode_id = lastEpisodeId;
          session.extracted_slots = {
            ...(session.extracted_slots || {}),
            mode: 'patient_info',
            patient_context: { id: pid, ...patientData },
            active_form: null,
          };
          const ackText = `${greet}\n\nModo información (no presencial). ¿Qué querés saber del paciente?`;
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({
            ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: session.active_patient_id,
            active_episode_id: session.active_episode_id, form: null,
          });
        }

        // Atención mode. No "¿nueva o anterior?" prompt: if the patient has an
        // open consultation we resume it; only when none is open (every prior
        // episode is `cerrado`, or there are none) do we open a new one. The
        // open episode IS the current consultation until it's closed.
        const resumeId = openEpisodeId;
        session.active_episode_id = resumeId
          ? resumeId
          : await openEpisodeFicha(mcp, session, pid);
        // Compute ficha completion once and reuse it for both the form and the
        // greeting, so the bot can tell the user exactly what's still pending.
        const marks = await fichaBookmarks(mcp, session);
        const firstGroup = marks.find(m => !m.done)?.id ?? null;
        const pendingLabels = marks.filter(m => !m.done).map(m => m.label);
        const fichaForm = firstGroup
          ? await fichaGroupFormFilled(firstGroup, mcp, session)
          : null;
        session.extracted_slots = {
          ...(session.extracted_slots || {}),
          mode: 'patient',
          patient_context: { id: pid, ...patientData },
          form_state: { kind: 'ficha' },
          ...(resumeId ? {} : { ficha_done: [] }),
          ...(firstGroup ? { ficha_current: firstGroup } : {}),
          active_form: fichaForm,
        };
        const lead = resumeId ? 'Continuamos la consulta en curso.' : 'Abrí una consulta nueva.';
        const fichaLine = pendingLabels.length
          ? (pendingLabels.length > 6
              ? `📋 Faltan ${pendingLabels.length} secciones de la ficha. Próximas: ${pendingLabels.slice(0, 3).join(', ')}…`
              : `📋 Falta completar en la ficha: ${pendingLabels.join(', ')}.`)
          : '✅ La ficha clínica está completa.';
        const ackText = `${greet}\n\n${lead}\n${fichaLine}`;
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: session.active_patient_id,
          active_episode_id: session.active_episode_id,
          form: fichaForm,
          bookmarks: marks,
        });
      }
      if (clrPatient) {
        session.active_patient_id = null;
        const ackText = `Paciente activo limpiado.`;
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: null,
          active_episode_id: session.active_episode_id,
        });
      }
      if (setEpisode) {
        session.active_episode_id = setEpisode[1];
        const ackText = `Episodio activo: ${setEpisode[1]}.`;
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: session.active_patient_id,
          active_episode_id: session.active_episode_id,
        });
      }
      if (clrEpisode) {
        session.active_episode_id = null;
        const ackText = `Episodio activo limpiado.`;
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: session.active_patient_id,
          active_episode_id: null,
        });
      }

      // ── Episode choice after activating a patient with prior history ──
      //    (the "¿consulta nueva o continuar la anterior?" prompt).
      const newConsult  = trimmed.match(/^\/?\s*(consulta\s+nueva|nueva\s+consulta)\s*$/i);
      const contConsult = trimmed.match(/^\/?\s*continuar(\s+(consulta|anterior|la\s+anterior))?\s*$/i);
      if ((newConsult || contConsult) && session.active_patient_id) {
        const slots = (session.extracted_slots || {}) as any;
        let lead: string;
        if (contConsult) {
          const epId = slots.pending_resume_episode || session.active_episode_id;
          if (epId) {
            session.active_episode_id = epId;
            lead = 'Continuamos la consulta anterior.';
          } else {
            session.active_episode_id = await openEpisodeFicha(mcp, session, session.active_patient_id);
            lead = 'No encontré una consulta previa; abrí una nueva.';
          }
        } else {
          session.active_episode_id = await openEpisodeFicha(mcp, session, session.active_patient_id);
          lead = 'Consulta nueva abierta.';
        }
        const firstGroup = await firstIncompleteFichaGroup(mcp, session);
        const fichaForm = firstGroup ? await fichaGroupFormFilled(firstGroup, mcp, session) : null;
        const restSlots = { ...slots };
        delete restSlots.pending_resume_episode;
        session.extracted_slots = {
          ...restSlots,
          mode: 'patient',
          form_state: { kind: 'ficha' },
          ...(contConsult ? {} : { ficha_done: [] }),
          ...(firstGroup ? { ficha_current: firstGroup } : {}),
          active_form: fichaForm,
        };
        const ackText = lead + (fichaForm ? '\n\nSeguimos con la ficha clínica:'
          : '\n\nLa ficha está completa — revisá lo que quieras desde los marcadores.');
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText, history: session.turns,
          toolCalls: [], active_patient_id: session.active_patient_id,
          active_episode_id: session.active_episode_id, form: fichaForm,
          bookmarks: await fichaBookmarks(mcp, session),
        });
      }

      // ── Close-session command: marks estado=cerrada and signals frontend
      //    so it can drop its sessionId and start fresh on next message.
      const closeSession = trimmed.match(/^\/?\s*(cerrar|cierra|finalizar?|terminar?|salir(?!\s+(paciente|episodio)))\s*(la\s+|de\s+)?(sesi[oó]n|chat)\s*$/i);
      if (closeSession) {
        session.estado = 'cerrada';
        session.pending_action = null;
        const ackText = 'Sesión cerrada. Iniciá una nueva cuando quieras.';
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: session.active_patient_id,
          active_episode_id: session.active_episode_id,
          session_closed: true,
        });
      }

      activePatientId = session.active_patient_id;
      activeEpisodeId = session.active_episode_id;

      // ── Confirmation gate: handle "sí/no" against a pending_action ────
      const confirmYes = /^\s*(s[ií]|si|confirmar|ok|adelante|yes)\s*$/i;
      const confirmNo  = /^\s*(no|cancelar|cancel|abort)\s*$/i;
      if (session.pending_action) {
        if (confirmYes.test(message.trim())) {
          return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        }
        if (confirmNo.test(message.trim())) {
          session.pending_action = null;
          const ackText = 'Acción cancelada.';
          session.turns = [
            ...session.turns,
            { role: 'user',      content: message },
            { role: 'assistant', content: ackText },
          ];
          await saveSession(mcp, session);
          return res.json({
            ok: true, session_id: sessionId, text: ackText,
            history: session.turns, toolCalls: [],
            active_patient_id: activePatientId,
            active_episode_id: activeEpisodeId,
          });
        }
        // Other input while a pending_action exists: keep the pending; the
        // LLM still sees state context, but user might be reconsidering.
        // Fall through to the normal LLM path below.
      }

      // ── V1 conversational flow gate (docs/CHATBOT_FLOW.md) ─────────────
      // Handles mode handshake, patient search/select and new-patient form.
      // Returns null when the turn should fall through to legacy handlers.
      {
        const v1 = await handleV1Flow({ session, message, mcp, formSubmission });
        if (v1) {
          // A flow that staged a pending_action (e.g. /nuevo-paciente): with the
          // gate disabled, execute it now instead of asking sí/no.
          if (!CONFIRM_GATE_ENABLED && session.pending_action) {
            return res.json(await executePendingActionResult(session, mcp, message, sessionId));
          }
          // session was already mutated + saved by handleV1Flow.
          // Persist the active form on the session so it survives reloads
          // and conversation switches (the form stays until it's filled).
          if ('form' in v1) {
            session.extracted_slots = {
              ...(session.extracted_slots || {}),
              active_form: v1.form ?? null,
            };
            await saveSession(mcp, session);
          }
          return res.json({
            ok: true, session_id: sessionId, text: v1.text,
            history: session.turns,
            toolCalls: [],
            active_patient_id: session.active_patient_id,
            active_episode_id: session.active_episode_id,
            pending_action: session.pending_action,
            quick_replies: v1.quick_replies || [],
            await_isic: v1.await_isic || [],
            form: (session.extracted_slots as any)?.active_form ?? null,
            bookmarks: v1.bookmarks ?? (((session.extracted_slots as any)?.form_state?.kind === 'ficha')
              ? await fichaBookmarks(mcp, session) : undefined),
          });
        }
      }

      // ── "resumen" — quick patient summary using entities.list filters ──
      if (/^\s*\/?\s*resumen\s*$/i.test(message.trim())) {
        if (!activePatientId) {
          const ackText = 'Activa un paciente primero (activar paciente <uuid>).';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const [pat, eps, imgs] = await Promise.all([
          mcp.call('entities.get',  { id: activePatientId }),
          mcp.call('entities.list', { type: '12000000-0000-0000-0000-000000000000', filter: { patient_id: activePatientId }, limit: 50 }),
          mcp.call('entities.list', { type: '16000000-0000-0000-0000-000000000000', filter: { patient_id: activePatientId }, limit: 50 }),
        ]);
        const epList   = Array.isArray(eps.data)  ? eps.data  : [];
        const imgList  = Array.isArray(imgs.data) ? imgs.data : [];
        const lastEp   = epList[0];
        const text =
          `Resumen de paciente \`${activePatientId.slice(0,8)}…\`:\n` +
          `  • episodios totales: ${epList.length}\n` +
          `  • imágenes clínicas: ${imgList.length}\n` +
          (lastEp ? `  • último episodio: ${lastEp.data?.fecha || '?'} (${lastEp.data?.estado || '?'})\n` : '') +
          `Para detalle, "ver paciente" o "ver episodio" tras activarlo.`;
        session.turns = [...session.turns,
          { role: 'user', content: message },
          { role: 'tool', tool_name: 'entities.list', content: JSON.stringify({ episodios: epList.length, imagenes: imgList.length, ultimo_episodio: lastEp?.id || null }) },
          { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }

      // ── chatter ─────────────────────────────────────────────────
      const noteMatch = message.trim().match(/^\/?\s*nota\s+(.+)$/i);
      if (noteMatch) {
        const target = activeEpisodeId || activePatientId;
        if (!target) {
          const ackText = 'Necesito un paciente o episodio activo para anclar la nota.';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const r = await mcp.call('chatter.add_note', { entity_id: target, body: noteMatch[1] });
        const text = r.ok ? `Nota agregada al ${activeEpisodeId ? 'episodio' : 'paciente'} ${target}.` : `No pude agregar nota: ${r.error}`;
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [{ name: 'chatter.add_note', args: { entity_id: target }, result: r }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }
      if (/^\s*\/?\s*ver\s+chatter\s*$/i.test(message.trim())) {
        const target = activeEpisodeId || activePatientId;
        if (!target) {
          const ackText = 'Necesito paciente o episodio activo.';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const r = await mcp.call('chatter.list', { entity_id: target });
        const text = r.ok ? `Feed de actividad del ${activeEpisodeId ? 'episodio' : 'paciente'}.` : `Error: ${r.error}`;
        session.turns = [...session.turns,
          { role: 'user', content: message },
          { role: 'tool', tool_name: 'chatter.list', content: JSON.stringify(r.ok ? r.data : { error: r.error }) },
          { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [{ name: 'chatter.list', args: { entity_id: target }, result: r }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }

      // ── reminder actions (no gate; reversible-ish) ──
      const completeRem = message.trim().match(/^\/?\s*completar\s+reminder\s+([0-9a-f-]{36})\s*(.*)$/i);
      if (completeRem) {
        const r = await mcp.call('reminders.complete', { id: completeRem[1], result: completeRem[2] || 'Marcado como completado por el agente' });
        const text = r.ok ? `Recordatorio ${completeRem[1]} marcado como completado.` : `No pude completar: ${r.error}`;
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [{ name: 'reminders.complete', args: { id: completeRem[1] }, result: r }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }
      const cancelRem = message.trim().match(/^\/?\s*cancelar\s+reminder\s+([0-9a-f-]{36})\s*$/i);
      if (cancelRem) {
        const r = await mcp.call('reminders.cancel', { id: cancelRem[1] });
        const text = r.ok ? `Recordatorio ${cancelRem[1]} cancelado.` : `No pude cancelar: ${r.error}`;
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [{ name: 'reminders.cancel', args: { id: cancelRem[1] }, result: r }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }
      const snoozeRem = message.trim().match(/^\/?\s*snooze\s+reminder\s+([0-9a-f-]{36})\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s*$/i);
      if (snoozeRem) {
        const until = `${snoozeRem[2]}T09:00:00.000Z`;
        const r = await mcp.call('reminders.snooze', { id: snoozeRem[1], until });
        const text = r.ok ? `Recordatorio ${snoozeRem[1]} pospuesto hasta ${snoozeRem[2]}.` : `No pude posponer: ${r.error}`;
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [{ name: 'reminders.snooze', args: { id: snoozeRem[1], until }, result: r }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }

      // ── "/logout" — close the bot session ──────────────────────
      if (/^\s*\/?\s*logout\s*$/i.test(message.trim())) {
        session.estado = 'cerrada';
        session.active_patient_id = null;
        session.active_episode_id = null;
        session.pending_action = null;
        const ackText = 'Sesión cerrada. Hasta luego.';
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
          toolCalls: [], active_patient_id: null, active_episode_id: null, pending_action: null });
      }

      // ── "/exportar [anonimizado]" — bundle paciente + episodios + diagnósticos + imágenes ──
      const exportMatch = message.trim().match(/^\s*\/?\s*exportar\s*(anonimizado)?\s*$/i);
      if (exportMatch) {
        const anonimizar = !!exportMatch[1];
        if (!activePatientId) {
          const ackText = 'Activa un paciente primero.';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const [pat, eps, imgs] = await Promise.all([
          mcp.call('entities.get',  { id: activePatientId }),
          mcp.call('entities.list', { type: '12000000-0000-0000-0000-000000000000', filter: { patient_id: activePatientId }, limit: 100 }),
          mcp.call('entities.list', { type: '16000000-0000-0000-0000-000000000000', filter: { patient_id: activePatientId }, limit: 100 }),
        ]);
        const mcpRef = mcp;
        const epIds = (Array.isArray(eps.data) ? eps.data : []).map((e: any) => e.id);
        const dxs   = (await Promise.all(epIds.map(id =>
          mcpRef.call('entities.list', { type: '13000000-0000-0000-0000-000000000000', search: id, limit: 50 })
        ))).flatMap(r => (Array.isArray(r.data) ? r.data : []));

        const rawBundle = {
          exported_at: new Date().toISOString(),
          patient: pat.data || null,
          episodes: eps.data || [],
          clinical_images: imgs.data || [],
          diagnoses: dxs,
        };
        const { redactPiiDeep } = await import('./redact.js');
        const bundle = anonimizar ? redactPiiDeep(rawBundle) : rawBundle;
        const ackText = `Bundle del paciente listo${anonimizar ? ' (anonimizado)' : ''} — ${(eps.data || []).length} episodios, ${(imgs.data || []).length} imágenes, ${dxs.length} diagnósticos.`;
        session.turns = [...session.turns,
          { role: 'user', content: message },
          { role: 'tool', tool_name: 'export.bundle', content: JSON.stringify(bundle) },
          { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText, history: session.turns,
          toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          download: {
            filename: `paciente_${activePatientId.slice(0,8)}${anonimizar ? '_anon' : ''}.json`,
            content_type: 'application/json',
            content: JSON.stringify(bundle, null, 2),
          },
        });
      }

      // ── "/signs k=v k=v" — update signos_vitales on the active episode ──
      const signsMatch = message.trim().match(/^\/?\s*signs?\s+(.+)$/i);
      if (signsMatch && activeEpisodeId) {
        const pairs = signsMatch[1].split(/\s+/).map((p: string) => p.split('=')).filter((p: string[]) => p.length === 2);
        if (!pairs.length) {
          const ackText = 'Formato: signs PA=120/80 FC=70 T=36.5 SatO2=98';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const sv: Record<string, string> = {};
        for (const [k, v] of pairs) sv[k] = v;

        const cur = await mcp.call('entities.get', { id: activeEpisodeId });
        const curData = (cur.ok && cur.data?.data) ? { ...cur.data.data } : {};
        delete (curData as any)._relations;
        curData.signos_vitales = JSON.stringify(sv);

        session.pending_action = {
          summary: `Registrar signos vitales (${Object.keys(sv).join(', ')}) en el episodio activo`,
          tool: 'entities.update',
          args: { id: activeEpisodeId, record_type: 'business', data: curData },
          successMessage: `Signos vitales guardados.`,
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) {
          return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        }
        const ackText =
          `Voy a registrar:\n` +
          Object.entries(sv).map(([k, v]) => `  • ${k}: ${v}`).join('\n') +
          `\n\n¿Confirmas? (sí / no)`;
        session.turns = [...session.turns,
          { role: 'user', content: message }, { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
          toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          pending_action: session.pending_action });
      }

      // ── "mostrar resultados imagen" — classifications, optionally scoped ──
      // Trailing clinical_image UUIDs scope the result to those images (the
      // §4.7 auto-flow passes the new ones); without ids it lists them all.
      // Each image is emitted with an inline [img:<attachment_id>] marker the
      // frontend renders as a thumbnail — no separate tool-result block.
      const mostrarImgMatch = message.trim().match(
        /^\/?\s*mostrar\s+resultados?\s+(?:de\s+(?:las?\s+)?)?im[áa]gen(?:es)?\b\s*(.*)$/i,
      );
      if (mostrarImgMatch) {
        if (!activeEpisodeId) {
          const ackText = 'Activa un episodio primero (activar episodio <uuid>).';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const wantIds = (mostrarImgMatch[1] || '')
          .split(/\s+/).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
        let images = await listEpisodeImagesWithClassifications(mcp, activeEpisodeId);
        if (wantIds.length) images = images.filter(im => wantIds.includes(im.id));
        let text: string;
        if (!images.length) {
          text = wantIds.length
            ? 'No encontré esas imágenes en el episodio.'
            : 'No hay imágenes clínicas en el episodio. Adjuntá una primero (📎).';
        } else {
          const blocks = images.map((img, i) => {
            const head = `**Imagen ${i + 1}**` +
              (img.privada ? ' · 🔒 privada (contiene rostro)' : '');
            const imgTag = img.attachment_id ? `[img:${img.attachment_id}]` : '';
            if (img.embedding_status === 'pending' && !img.classifications.length) {
              return [head, imgTag, '  Clasificación en proceso…'].filter(Boolean).join('\n');
            }
            if (!img.classifications.length) {
              return [head, imgTag, '  Sin resultados aún.'].filter(Boolean).join('\n');
            }
            const clsLines = img.classifications.map((c: any) => {
              const labels = [...c.labels]
                .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
                .slice(0, 3)
                .map((l: any) => `${l.label} ${((l.confidence || 0) * 100).toFixed(0)}%`)
                .join(', ');
              return `  • ${c.model_id}: ${labels || '—'}`;
            });
            return [head, imgTag, ...clsLines].filter(Boolean).join('\n');
          });
          text = [
            `**Resultados de los modelos IA** — ${images.length} imagen(es):`,
            '',
            ...blocks,
            '',
            'Recordá: las clasificaciones son informativas. El diagnóstico es decisión del médico (D-Aux-1).',
          ].join('\n');
        }
        const userTurn = wantIds.length
          ? '🔬 Resultados de las imágenes cargadas'
          : 'Mostrar resultados de imagen';
        session.turns = [...session.turns,
          { role: 'user', content: userTurn },
          { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }

      // ── "sugerir diagnostico" — read classifications + map to CIE-10 ──
      if (/^\s*\/?\s*sugerir\s+diagn[óo]stico\s*$/i.test(message.trim())) {
        if (!activeEpisodeId) {
          const ackText = 'Activa un episodio primero (activar episodio <uuid>).';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const list = await mcp.call('entities.list', {
          type: CLINICAL_IMAGE_ENTITY_ID,
          filter: { episode_id: activeEpisodeId },
          limit: 1,
        });
        const img = Array.isArray(list.data) && list.data.length ? list.data[0] : null;
        if (!img) {
          const ackText = 'No hay imágenes en el episodio. Adjunta una primero.';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const cls = await mcp.call('classifications.list', { entity_id: img.id });
        const classifList = Array.isArray(cls.data) ? cls.data : [];
        const multi = classifList.find((c: any) => c.model_id === 'isic-multiclass-v1');
        const triage = classifList.find((c: any) => c.model_id === 'isic-bin-triage-v1');
        if (!multi && !triage) {
          const ackText = 'La imagen aún no tiene clasificaciones. Espera a que el worker ISIC procese.';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const top = Array.isArray(multi?.labels) && multi.labels.length ? multi.labels[0] : null;
        const triageTop = Array.isArray(triage?.labels) && triage.labels.length ? triage.labels[0] : null;
        const mapped = top && HAM_TO_ICD[top.label] ? HAM_TO_ICD[top.label] : null;
        const text = [
          `**Sugerencia IA** (imagen \`${img.id.slice(0,8)}…\`):`,
          triageTop ? `  • Triage: ${triageTop.label} (${(triageTop.confidence * 100).toFixed(0)}%)` : null,
          top       ? `  • Clase top: ${top.label} (${(top.confidence * 100).toFixed(0)}%)` : null,
          mapped    ? `  • Mapping CIE-10 propuesto: **${mapped[0]}** — ${mapped[1]}` : null,
          '',
          'Recordá: la sugerencia es informativa. El diagnóstico es decisión del médico (D-Aux-1).',
          mapped    ? `Para registrarlo: \`diagnostico ${mapped[0]} ${mapped[1]}\`` : null,
        ].filter(Boolean).join('\n');
        session.turns = [...session.turns,
          { role: 'user', content: message },
          { role: 'tool', tool_name: 'classifications.list', content: JSON.stringify(classifList) },
          { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [{ name: 'classifications.list', args: { entity_id: img.id }, result: cls }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }

      // ── "casos similares" — vector search over the latest image of the active episode ──
      if (/^\s*\/?\s*(casos\s+similares|similares)\s*$/i.test(message.trim())) {
        if (!activeEpisodeId) {
          const ackText = 'Necesito un episodio activo. Usa "activar episodio <uuid>" primero.';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        // Find the most recent clinical_image whose data references this episode.
        const list = await mcp.call('entities.list', {
          type: '16000000-0000-0000-0000-000000000000',
          filter: { episode_id: activeEpisodeId },
          limit: 5,
        });
        const img = Array.isArray(list.data) && list.data.length ? list.data[0] : null;
        if (!img) {
          const ackText = 'No encontré imágenes clínicas del episodio activo. Adjunta una primero (📎).';
          session.turns = [...session.turns,
            { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const search = await mcp.call('vectors.search', {
          model_id: 'isic-resnet50-v1',
          entity_id: img.id,
          k: 5,
        });
        const text = search.ok
          ? `Casos similares a la imagen \`${img.id.slice(0,8)}…\` (modelo isic-resnet50-v1):`
          : `No pude buscar similares: ${search.error || 'sin embedding aún (¿ya corrió el worker ISIC?)'}`;
        session.turns = [...session.turns,
          { role: 'user', content: message },
          { role: 'tool', tool_name: 'vectors.search',
            content: JSON.stringify(search.ok ? search.data : { error: search.error }) },
          { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text,
          history: session.turns,
          toolCalls: [{ name: 'vectors.search', args: { model_id: 'isic-resnet50-v1', entity_id: img.id, k: 5 }, result: search }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
        });
      }

      // ── Stage "/diagnostico <CIE10> <descripcion>" (presuntivo by default) ──
      const diagMatch = message.trim().match(/^\/?\s*diagn[óo]stico\s+([A-Z][0-9]{1,2}(?:\.[0-9]{1,2})?)\s+(.+)$/i);
      if (diagMatch && activeEpisodeId) {
        const codigo = diagMatch[1].toUpperCase();
        const desc   = diagMatch[2].trim();
        session.pending_action = {
          summary: `Crear diagnóstico presuntivo (${codigo}) en el episodio ${activeEpisodeId}`,
          tool: 'entities.create',
          args: {
            record_type: 'business',
            entity_id:   '13000000-0000-0000-0000-000000000000',
            title:       `dx_${codigo}`,
            data: {
              ['12000000-0000-0000-0000-000000000000:episode_id']: activeEpisodeId,
              tipo:          'presuntivo',
              codigo_cie10:  codigo,
              descripcion:   desc,
            },
          },
          successMessage: `Diagnóstico presuntivo guardado (id: {{id}}, CIE-10: ${codigo}).`,
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) {
          return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        }
        const ackText =
          `Voy a crear un diagnóstico presuntivo:\n` +
          `  • episodio: ${activeEpisodeId}\n` +
          `  • CIE-10: ${codigo}\n` +
          `  • descripción: ${desc}\n` +
          `  • tipo: presuntivo\n\n` +
          `¿Confirmas? (sí / no)\n` +
          `_(Para definitivo necesitarás evidencia AP — D-Aux-2.)_`;
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          pending_action: session.pending_action,
        });
      }

      // ── Stage "/escalar a <user-uuid> <razón>" behind gate ──
      const escalateMatch = message.trim().match(/^\/?\s*escalar\s+a\s+([0-9a-f-]{36})\b\s*(.*)$/i);
      if (escalateMatch && activeEpisodeId) {
        const reviewer = escalateMatch[1];
        const reason   = (escalateMatch[2] || '').trim() || 'Derivado para segunda opinión';
        session.pending_action = {
          summary: `Escalar episodio ${activeEpisodeId} a ${reviewer}`,
          tool: 'entities.request_review',
          args: {
            entity_id: activeEpisodeId,
            reviewers: [reviewer],
            reason,
          },
          successMessage: `Episodio escalado. Recordatorio creado para el reviewer.`,
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) {
          return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        }
        const ackText =
          `Voy a escalar el episodio ${activeEpisodeId}.\n` +
          `  • reviewer: ${reviewer}\n` +
          `  • motivo: ${reason}\n\n` +
          `¿Confirmas? (sí / no)`;
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          pending_action: session.pending_action,
        });
      }

      // ══════════════════════════════════════════════════════════════════
      // Telemedicina (TELEMEDICINA.md): el episodio es el "caso" que viaja
      // primario → turno → especialistas. Comandos:
      //   enviar caso [motivo]        (médico primario)  → estado 'enviada' + bandeja de turno
      //   entrantes | turno           (residente)        → bandeja compartida de entrantes
      //   reclamar [<uuid>]           (residente)        → claim → estado 'en_triage'
      //   derivar a <especialidad> .. (residente)        → request_review a círculo + 'derivada'
      //   responder <texto>           (residente/espec.) → recomendación + 'respondida' + notifica primario
      // ══════════════════════════════════════════════════════════════════

      // ── "enviar caso [motivo]" — el primario envía el episodio al turno ──
      const sendCaseMatch = message.trim().match(/^\/?\s*enviar\s+caso\b\s*(.*)$/i);
      if (sendCaseMatch) {
        if (!activeEpisodeId) {
          const ackText = 'Necesito un episodio activo (la ficha del caso) antes de enviarlo. Activá o creá uno.';
          session.turns = [...session.turns, { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
            toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const motivo = (sendCaseMatch[1] || '').trim();
        const me2 = await mcp.call('auth.whoami', {});
        const userId2 = ((me2 as any)?.data?.user?.id as string) || null;
        const reason = motivo || 'Teleconsulta enviada a turno para triage';
        session.pending_action = {
          summary: `Enviar episodio ${activeEpisodeId} a la bandeja de turno`,
          batch: [
            { tool: 'entities.update', args: { id: activeEpisodeId, record_type: 'business',
              data: { medico_primario_id: userId2, ...(motivo ? { motivo_consulta: motivo } : {}) } } },
            { tool: 'entities.request_review', args: { entity_id: activeEpisodeId, group_id: 'turno',
              reason, status_value: 'enviada' } },
          ],
          successMessage: 'Caso enviado a la bandeja de turno. Los médicos en turno fueron notificados.',
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        const ackText = `Voy a enviar el episodio ${activeEpisodeId} a la bandeja de turno.\n  • motivo: ${reason}\n\n¿Confirmás? (sí / no)`;
        session.turns = [...session.turns, { role: 'user', content: message }, { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns, toolCalls: [],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId, pending_action: session.pending_action });
      }

      // ── "entrantes" / "turno" — bandeja compartida de casos por triagear ──
      if (/^\/?\s*(entrantes|turno|bandeja(?:\s+de)?\s+turno)\s*$/i.test(message.trim())) {
        const calls: any[] = [];
        const seen = new Set<string>();
        const rows: any[] = [];
        for (const estado of ['enviada', 'en_triage']) {
          const r = await mcp.call('entities.list', { type: EPISODE_ENTITY_ID, filter: { estado }, limit: 100 });
          calls.push({ name: 'entities.list', args: { type: EPISODE_ENTITY_ID, filter: { estado } }, result: r });
          for (const e of (Array.isArray((r as any)?.data) ? (r as any).data : [])) {
            if (!seen.has(e.id)) { seen.add(e.id); rows.push(e); }
          }
        }
        const lines = rows.map((e: any) => {
          const d = e.data || {};
          const who = d.responsable_actual_id ? ` · reclamado` : '';
          return `  • \`${String(e.id).slice(0, 8)}…\` [${d.estado || '?'}] ${d.motivo_consulta || e.title || 's/motivo'}${who}`;
        });
        const text = rows.length
          ? `**Bandeja de turno** (${rows.length} caso(s) entrante(s)):\n${lines.join('\n')}\n\nUsá \`reclamar <uuid>\` para tomar uno.`
          : 'Bandeja de turno vacía: no hay casos entrantes.';
        session.turns = [...session.turns, { role: 'user', content: message }, { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns, toolCalls: calls,
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }

      // ── "reclamar [<uuid>]" — el médico en turno toma un caso ──
      const claimMatch = message.trim().match(/^\/?\s*reclamar\b\s*([0-9a-f-]{36})?\s*$/i);
      if (claimMatch) {
        const target = claimMatch[1] || activeEpisodeId;
        if (!target) {
          const ackText = 'Indicá qué caso reclamar: `reclamar <uuid>` (o activá un episodio).';
          session.turns = [...session.turns, { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns, toolCalls: [],
            active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const r = await mcp.call('entities.claim', { entity_id: target, status_value: 'en_triage' });
        let text: string;
        if ((r as any)?.ok) {
          session.active_episode_id = target;
          activeEpisodeId = target;
          text = `Reclamaste el caso \`${String(target).slice(0, 8)}…\` (ahora en triage). Quedó como tu episodio activo.\nPodés \`responder <texto>\` o \`derivar a <especialidad> <motivo>\`.`;
        } else {
          text = `No pude reclamar el caso: ${(r as any)?.error || 'error'}.`;
        }
        session.turns = [...session.turns, { role: 'user', content: message },
          { role: 'tool', tool_name: 'entities.claim', content: JSON.stringify(r) }, { role: 'assistant', content: text }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text, history: session.turns,
          toolCalls: [{ name: 'entities.claim', args: { entity_id: target, status_value: 'en_triage' }, result: r }],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
      }

      // ── "derivar a <especialidad-slug> [motivo]" — al círculo de especialistas ──
      const deriveMatch = message.trim().match(/^\/?\s*derivar\s+a\s+([a-z][a-z0-9_-]+)\b\s*(.*)$/i);
      if (deriveMatch) {
        if (!activeEpisodeId) {
          const ackText = 'Activá o reclamá un episodio antes de derivarlo.';
          session.turns = [...session.turns, { role: 'user', content: message }, { role: 'assistant', content: ackText }];
          await saveSession(mcp, session);
          return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns, toolCalls: [],
            active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
        }
        const slug = deriveMatch[1].toLowerCase();
        const reason = (deriveMatch[2] || '').trim() || `Derivado al círculo "${slug}" para segunda opinión`;
        session.pending_action = {
          summary: `Derivar episodio ${activeEpisodeId} al círculo "${slug}"`,
          batch: [
            { tool: 'entities.update', args: { id: activeEpisodeId, record_type: 'business',
              data: { derivado_a: slug, especialidad: slug } } },
            { tool: 'entities.request_review', args: { entity_id: activeEpisodeId, group_id: slug,
              reason, status_value: 'derivada' } },
          ],
          successMessage: `Caso derivado al círculo "${slug}". Sus especialistas fueron notificados.`,
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        const ackText = `Voy a derivar el episodio ${activeEpisodeId} al círculo "${slug}".\n  • motivo: ${reason}\n\n¿Confirmás? (sí / no)`;
        session.turns = [...session.turns, { role: 'user', content: message }, { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns, toolCalls: [],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId, pending_action: session.pending_action });
      }

      // ── "responder <texto>" — recomendación diagnóstica que vuelve al primario ──
      const answerMatch = message.trim().match(/^\/?\s*responder\s+([\s\S]+)$/i);
      if (answerMatch && activeEpisodeId) {
        const recomendacion = answerMatch[1].trim();
        const me3 = await mcp.call('auth.whoami', {});
        const userId3 = ((me3 as any)?.data?.user?.id as string) || null;
        const cur = await mcp.call('entities.get', { id: activeEpisodeId });
        const curData = ((cur as any)?.ok && (cur as any)?.data?.data) ? (cur as any).data.data : {};
        const primarioId = curData.medico_primario_id || null;
        const today = new Date().toISOString().slice(0, 10);
        const batch: any[] = [
          { tool: 'entities.update', args: { id: activeEpisodeId, record_type: 'business',
            data: { recomendacion, recomendacion_por: userId3, recomendacion_at: today, estado: 'respondida' } } },
        ];
        if (primarioId) {
          // Notifica al primario. recomendacion es contenido clínico (no PII §13.3.1).
          batch.push({ tool: 'reminders.create', args: {
            entity_id: activeEpisodeId, owner_user_id: primarioId,
            title: 'Respuesta a tu teleconsulta',
            message: recomendacion,
            due_at: new Date().toISOString(),
            channels: ['in_app', 'email', 'telegram', 'web_push'],
          } });
        }
        session.pending_action = {
          summary: `Responder teleconsulta ${activeEpisodeId}`,
          batch,
          successMessage: primarioId
            ? 'Recomendación registrada y notificada al médico primario.'
            : 'Recomendación registrada (sin médico primario asociado para notificar).',
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        const ackText = `Voy a registrar tu recomendación en el episodio ${activeEpisodeId} y notificar al primario.\n\n¿Confirmás? (sí / no)`;
        session.turns = [...session.turns, { role: 'user', content: message }, { role: 'assistant', content: ackText }];
        await saveSession(mcp, session);
        return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns, toolCalls: [],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId, pending_action: session.pending_action });
      }

      // ── Stage "cerrar episodio [YYYY-MM-DD] [motivo]" behind gate ──
      const closeMatch = message.trim().match(/^\/?\s*cerrar\s+episodio\b\s*([0-9]{4}-[0-9]{2}-[0-9]{2})?\s*(.*)$/i);
      if (closeMatch && activeEpisodeId) {
        const proxFecha   = closeMatch[1] || '';
        const proxMotivo  = (closeMatch[2] || '').trim() || 'Control de seguimiento';

        // PUT replaces `data` wholesale, so we fetch the current episode and
        // merge the close fields on top to preserve patient_id, medico_id,
        // fecha, motivo_consulta, etc.
        const cur = await mcp.call('entities.get', { id: activeEpisodeId });
        const curData = (cur.ok && cur.data?.data) ? { ...cur.data.data } : {};
        delete (curData as any)._relations;

        // Authorization (PAPER §13.6): the responsible doctor — the current
        // responsable_actual_id, or the treating medico_id when no one has
        // claimed the case — may close their own episode (ownership). Closing
        // ANY episode requires the `episode:close` permission (granted to
        // supermedico; admin via the *:*:*:* wildcard).
        const meClose = await mcp.call('auth.whoami', {});
        const meUser: any = meClose.data?.user || {};
        const callerId = meUser.id || null;
        const perms: string[] = Array.isArray(meUser.permissions) ? meUser.permissions : [];
        const respId   = (curData as any).responsable_actual_id || '';
        const medicoId = (curData as any).medico_id || '';
        const isResponsible = respId ? callerId === respId : callerId === medicoId;
        const canCloseAny  = perms.includes('episode:close') || perms.includes('*:*:*:*');
        if (!isResponsible && !canCloseAny) {
          const ackText = 'Solo el médico responsable del episodio (o alguien con permiso para cerrar episodios) puede cerrarlo.';
          session.turns = [
            ...session.turns,
            { role: 'user',      content: message },
            { role: 'assistant', content: ackText },
          ];
          await saveSession(mcp, session);
          return res.json({
            ok: true, session_id: sessionId, text: ackText,
            history: session.turns, toolCalls: [],
            active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          });
        }

        const merged: Record<string, unknown> = { ...curData, estado: 'cerrado' };
        if (proxFecha) {
          merged.proximo_control_fecha  = proxFecha;
          merged.proximo_control_motivo = proxMotivo;
        }

        session.pending_action = {
          summary: `Cerrar episodio ${activeEpisodeId}`,
          tool: 'entities.update',
          args: {
            id: activeEpisodeId,
            record_type: 'business',
            data: merged,
          },
          successMessage: proxFecha
            ? `Episodio cerrado. Programé recordatorio de control para ${proxFecha} ("${proxMotivo}").`
            : `Episodio cerrado.`,
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) {
          return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        }
        const ackText =
          `Voy a cerrar el episodio ${activeEpisodeId}.\n` +
          (proxFecha
            ? `  • próximo control: ${proxFecha}\n  • motivo: ${proxMotivo}\n`
            : `  • sin próximo control programado\n`) +
          `\n¿Confirmas? (sí / no)`;
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          pending_action:    session.pending_action,
        });
      }

      // ── Stage "nuevo episodio <motivo>" behind confirmation gate ──
      const newEpisodeMatch = message.trim().match(/^\/?\s*nuevo\s+episodio\b\s*(.*)$/i);
      if (newEpisodeMatch) {
        if (!activePatientId) {
          const ackText = 'Necesito un paciente activo. Usa "activar paciente <uuid>" primero.';
          session.turns = [
            ...session.turns,
            { role: 'user',      content: message },
            { role: 'assistant', content: ackText },
          ];
          await saveSession(mcp, session);
          return res.json({
            ok: true, session_id: sessionId, text: ackText,
            history: session.turns, toolCalls: [],
            active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          });
        }
        const motivo = (newEpisodeMatch[1] || '').trim() || 'Consulta general';
        const today  = new Date().toISOString().slice(0, 10);
        const me = await mcp.call('auth.whoami', {});
        const userId = (me.data?.user?.id as string) || null;
        session.pending_action = {
          summary: `Crear episodio para paciente ${activePatientId}`,
          tool: 'entities.create',
          args: {
            record_type: 'business',
            entity_id:   '12000000-0000-0000-0000-000000000000',
            title:       `episode_${today}`,
            data: {
              ['11000000-0000-0000-0000-000000000000:patient_id']: activePatientId,
              medico_id:       userId,
              fecha:           today,
              tipo:            'presencial',
              motivo_consulta: motivo,
              estado:          'en_curso',
            },
          },
          successMessage: `Episodio creado (id: {{id}}). Lo activo automáticamente; puedes ya subir imágenes.`,
          createdAt: new Date().toISOString(),
        };
        if (!CONFIRM_GATE_ENABLED) {
          return res.json(await executePendingActionResult(session, mcp, message, sessionId));
        }
        const ackText =
          `Voy a crear un episodio:\n` +
          `  • paciente: ${activePatientId}\n` +
          `  • fecha: ${today}\n` +
          `  • tipo: presencial\n` +
          `  • motivo: ${motivo}\n` +
          `  • estado: en_curso\n\n` +
          `¿Confirmas? (sí / no)`;
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: activePatientId, active_episode_id: activeEpisodeId,
          pending_action:    session.pending_action,
        });
      }

      // ── Image classification answer: lesión vs consentimiento ──
      // Resolves the pending image saved when the user uploaded it. The choice
      // IS the explicit user action, so we write directly (no sí/no gate).
      const imgKind = message.trim().match(/^\/?\s*imagen\s+(lesi[oó]n|consentimiento)\s*$/i);
      const pendingImage = (session.extracted_slots as any)?.pending_image;
      if (imgKind && pendingImage?.attachment_id) {
        const isConsent = /consent/i.test(imgKind[1]);
        const aid  = pendingImage.attachment_id as string;
        const name = (pendingImage.name as string) || aid.slice(0, 8);
        // Clear the pending image regardless of outcome.
        const slots = { ...(session.extracted_slots || {}) };
        delete (slots as any).pending_image;
        session.extracted_slots = slots;

        if (isConsent) {
          if (!activePatientId) {
            const ackText = 'Necesito un paciente activo para registrar el consentimiento.';
            session.turns = [...session.turns,
              { role: 'user', content: message }, { role: 'assistant', content: ackText }];
            await saveSession(mcp, session);
            return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
              toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
          }
          session.pending_action = {
            summary: `Crear consent (imagen) para paciente ${activePatientId}`,
            tool: 'entities.create',
            args: {
              record_type: 'business',
              entity_id:   CONSENT_ENTITY_ID,
              title:       `consent_imagen_${aid.slice(0, 8)}`,
              data: {
                [`${PATIENT_ENTITY_ID}:patient_id`]: activePatientId,
                tipo: 'imagen_clinica',
                version: 'imagen-subida',
                documento: aid,
                firmado_at: new Date().toISOString().slice(0, 10),
              },
            },
            successMessage: 'Imagen registrada como consentimiento del paciente.',
            createdAt: new Date().toISOString(),
          };
        } else {
          if (!activeEpisodeId) {
            const ackText = 'Necesito un episodio activo para registrar la imagen de la lesión.';
            session.turns = [...session.turns,
              { role: 'user', content: message }, { role: 'assistant', content: ackText }];
            await saveSession(mcp, session);
            return res.json({ ok: true, session_id: sessionId, text: ackText, history: session.turns,
              toolCalls: [], active_patient_id: activePatientId, active_episode_id: activeEpisodeId });
          }
          session.pending_action = {
            summary: `Crear clinical_image '${name}' ligada al episodio ${activeEpisodeId}`,
            tool: 'entities.create',
            args: {
              record_type: 'business',
              entity_id:   CLINICAL_IMAGE_ENTITY_ID,
              title:       `clinical_image_${name}`,
              data: {
                ['12000000-0000-0000-0000-000000000000:episode_id']: activeEpisodeId,
                [`${PATIENT_ENTITY_ID}:patient_id`]: activePatientId,
                attachment_id: aid,
                field_key:     'lesion',
                consentimiento_uso_imagen: true,
                embedding_status: 'pending',
              },
            },
            successMessage: 'Imagen registrada como imagen de lesión ligada al episodio.',
            createdAt: new Date().toISOString(),
          };
        }
        const payload = await executePendingActionResult(session, mcp, message, sessionId);
        // Take the initiative: keep the ficha moving by asking the next pending
        // section instead of stopping at "imagen registrada".
        if ((session.extracted_slots as any)?.form_state?.kind === 'ficha') {
          const nextGroup = await firstIncompleteFichaGroup(mcp, session);
          const nextForm = nextGroup ? await fichaGroupFormFilled(nextGroup, mcp, session) : null;
          session.extracted_slots = {
            ...(session.extracted_slots || {}),
            ...(nextGroup ? { ficha_current: nextGroup } : {}),
            active_form: nextForm,
          };
          await saveSession(mcp, session);
          payload.form = nextForm;
          payload.text = nextForm
            ? `${payload.text}\n\nSigamos con la ficha:`
            : `${payload.text}\n\nLa ficha está completa. ¿Necesitás algo más?`;
          payload.bookmarks = await fichaBookmarks(mcp, session);
        }
        return res.json(payload);
      }

      // ── Image uploaded: ask whether it's a lesion image or a consent form ──
      // (No sí/no gate; the lesion/consent choice is the explicit action.)
      const attachMatch = message.match(/\[adjunto:\s*([^·]+)·\s*([0-9a-f-]{36})\s*\]/i);
      if (attachMatch && activePatientId) {
        const fileName     = attachMatch[1].trim();
        const attachmentId = attachMatch[2];
        session.extracted_slots = {
          ...(session.extracted_slots || {}),
          pending_image: { attachment_id: attachmentId, name: fileName },
        };
        const ackText = '¿Esta imagen es de la lesión o un formulario de consentimiento?';
        session.turns = [
          ...session.turns,
          { role: 'user',      content: message },
          { role: 'assistant', content: ackText },
        ];
        await saveSession(mcp, session);
        return res.json({
          ok: true, session_id: sessionId, text: ackText,
          history: session.turns, toolCalls: [],
          active_patient_id: activePatientId,
          active_episode_id: activeEpisodeId,
          quick_replies: [
            { label: '🔬 Imagen de lesión', send: 'imagen lesion' },
            { label: '📄 Consentimiento',   send: 'imagen consentimiento' },
          ],
        });
      }

      // Inject current state as a system turn so the LLM is aware.
      const stateNote: ChatTurn = {
        role: 'system',
        content: `Contexto activo: paciente=${activePatientId ?? '(ninguno)'}, episodio=${activeEpisodeId ?? '(ninguno)'}. ` +
                 `Comandos: "activar paciente <uuid>", "salir paciente", "activar episodio <uuid>", "salir episodio".` +
                 // Las dudas que quedaron en cola de turnos anteriores, para que
                 // el agente las retome de a una en vez de perderlas.
                 (session.pending_slots?.length ? ' ' + pendingQuestionsNote(session.pending_slots) : ''),
      };
      inputHistory = [...session.turns, stateNote, { role: 'user', content: message }];
    } else if (Array.isArray(history)) {
      inputHistory = history as ChatTurn[];
    } else {
      return res.status(400).json({ ok: false, error: 'Provide either { message, session_id? } or { history }' });
    }

    const out = await runAgentTurn({ jwt, apiKey, history: inputHistory, mcp });

    // El agente adjunta las dudas que deja en cola en un marcador al final del
    // mensaje. Se saca ANTES de responder y de persistir: el usuario no debe
    // verlo, ni acá ni al releer el hilo.
    const queued = extractPendingQuestions(out.text);
    if (queued.questions !== null) {
      out.text = queued.text;
      const lastIdx = out.history.map(t => t.role).lastIndexOf('assistant');
      if (lastIdx >= 0) {
        out.history = out.history.map((t, i) =>
          i === lastIdx ? { ...t, content: extractPendingQuestions(t.content).text } : t);
      }
    }

    if (sessionId && mcp) {
      const session = await loadSession(mcp, sessionId);
      if (session) {
        // Don't persist the synthetic system note — strip it before saving.
        session.turns = out.history.filter(t => t.role !== 'system');
        // Sin marcador se conserva la cola anterior: el agente pudo haber hecho
        // solo una tool call, y perderla ahí lo haría olvidar lo que faltaba.
        if (queued.questions !== null) session.pending_slots = queued.questions;
        session.tool_calls = [
          ...session.tool_calls,
          ...out.toolCalls.map(tc => ({
            name: tc.name, args: tc.args, ok: tc.result.ok, t: new Date().toISOString(),
          })),
        ];
        await saveSession(mcp, session);
        activePatientId = session.active_patient_id;
        activeEpisodeId = session.active_episode_id;
        sessionForHeader = session;
      }
    }

    let pendingAction: any = null;
    let statusHeader = '';
    if (sessionId && mcp) {
      const finalSession = await loadSession(mcp, sessionId);
      pendingAction = finalSession?.pending_action || null;
      statusHeader = computeStatusHeader(finalSession);
    }

    res.json({
      ok: true,
      session_id: sessionId,
      active_patient_id: activePatientId,
      active_episode_id: activeEpisodeId,
      pending_action: pendingAction,
      status_header: statusHeader,
      ...out,
    });
  } catch (err) { next(err); }
  finally {
    if (mcp) await mcp.close().catch(() => {});
  }
};

app.post('/api/bot/chat', chatHandler);

/**
 * Programmatic entry point to the exact same chat brain used by the HTTP
 * endpoint. Builds a minimal Express-compatible req/res shim and runs
 * `chatHandler`, so any non-HTTP channel (e.g. the WhatsApp webhook on
 * :9997) goes through identical session handling, the confirmation gate
 * and PII redaction — no logic is duplicated.
 */
export function invokeChat(input: {
  body: any;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(
      Object.entries(input.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const req: any = {
      body: input.body || {},
      header: (name: string) => headers[name.toLowerCase()] ?? '',
    };
    let statusCode = 200;
    const res: any = {
      status(code: number) { statusCode = code; return res; },
      json(payload: any) { resolve({ status: statusCode, body: payload }); return res; },
    };
    Promise.resolve(chatHandler(req, res, (err: any) => reject(err))).catch(reject);
  });
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[cepi-bot] error:', err);
  res.status(500).json({ ok: false, error: err?.message || 'Internal error' });
});

const server = app.listen(PORT, () => {
  console.log(`🤖 cepi-bot listening on :${PORT}`);
});

// WhatsApp webhook on its own port (default :9997), sharing the same brain.
const whatsappServer = startWhatsapp(invokeChat);

// Telegram webhook on its own port (default :9998), sharing the same brain.
const telegramServer = startTelegram(invokeChat);

async function shutdown(signal: string) {
  console.log(`[${signal}] shutting down cepi-bot`);
  whatsappServer.close();
  telegramServer.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
