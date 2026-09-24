/**
 * Thin JSON client. The Vite dev server proxies /api/auth and
 * /api/entities to TodoERP (:3001) and /api/bot to cepi-bot (:3002).
 */

function getJwt() {
  return localStorage.getItem('cepi.jwt') || '';
}

async function call(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const jwt = getJwt();
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { /* */ }
  if (!res.ok) {
    const msg = body?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    // El código HTTP viaja en el Error: sin esto, distinguir un 403 de un 404 exigía
    // parsear el mensaje, que además cambia con el idioma y con el endpoint.
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function login(email, password) {
  const res = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (res?.token) {
    localStorage.setItem('cepi.jwt', res.token);
    // Let the PWA layer (re)subscribe to web push now that we have a token.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('cepi:auth'));
  }
  return res;
}

export function logout() {
  localStorage.removeItem('cepi.jwt');
  localStorage.removeItem('cepi.session_id');
  // Aviso para que la capa nativa desregistre el push (device-token).
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('cepi:logout'));
  // Future: hit a /api/bot/logout to mark bot_session.estado = 'cerrada'.
}

// Borra la cuenta propia (App Store 5.1.1(v), Google Play). El backend exige la
// confirmación explícita en el cuerpo; las historias clínicas se conservan (PAPER
// §24.7). Tras el éxito, quien llama sigue el mismo camino que un logout.
export async function deleteAccount() {
  return call('/api/auth/me', { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
}

export async function register({ name, email, password, phone, cedula }) {
  return call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, phone, cedula }),
  });
}

export async function verifyEmail(email, code) {
  return call('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) });
}

export async function resendVerifyCode(email) {
  return call('/api/auth/resend-code', { method: 'POST', body: JSON.stringify({ email }) });
}

// --- DoctoPro (repositorio de consulta externo) -------------------------------
export async function doctoproStatus() {
  return call('/api/doctopro/status', { method: 'GET' });
}
export async function searchDoctoProPatients(q) {
  return call(`/api/doctopro/pacientes?q=${encodeURIComponent(q)}`, { method: 'GET' });
}
export async function getDoctoProPatient(id) {
  return call(`/api/doctopro/pacientes/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function googleLogin(credential) {
  const res = await call('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });
  if (res?.token) {
    localStorage.setItem('cepi.jwt', res.token);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('cepi:auth'));
  }
  return res;
}

// ── Admin (user management) ────────────────────────────────────────────────
export async function adminListUsers(role) {
  const q = role ? `?role=${encodeURIComponent(role)}` : '';
  return call(`/api/admin/users${q}`, { method: 'GET' });
}

export async function adminListRoles() {
  return call('/api/admin/roles', { method: 'GET' });
}

// ── Telemedicina: destinos de derivación (círculos + sus miembros) ──────────────
export async function listGroups(kind) {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return call(`/api/groups${q}`, { method: 'GET' });
}

export async function listGroupMembers(idOrSlug) {
  return call(`/api/groups/${encodeURIComponent(idOrSlug)}/members`, { method: 'GET' });
}

// A quién está derivado un episodio ahora mismo (revisiones pendientes).
export async function listEntityDerivations(entityId) {
  return call(`/api/review-queue/entity/${encodeURIComponent(entityId)}`, { method: 'GET' });
}

export async function adminUpdateUser(id, patch) {
  return call(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function adminSetUserGroups(id, slugs) {
  return call(`/api/admin/users/${encodeURIComponent(id)}/groups`, {
    method: 'PUT',
    body: JSON.stringify({ slugs }),
  });
}

export async function adminSetUserOrgs(id, orgIds) {
  return call(`/api/admin/users/${encodeURIComponent(id)}/orgs`, {
    method: 'PUT',
    body: JSON.stringify({ org_ids: orgIds }),
  });
}

// ── Notificaciones (recordatorios del usuario) ──────────────────────────────
// Backed by TodoERP /api/reminders. Clinical roles have `reminders:read_own`,
// so this returns only the caller's own reminders (derivaciones recibidas,
// recordatorios de próximo control, etc.).
export async function listReminders(params = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.entity_id) q.set('entity_id', params.entity_id);
  // La campana es personal: aunque el rol tenga reminders:read_all, se limita al
  // dueño para no ver notificaciones de otros.
  if (params.owner_user_id) q.set('owner_user_id', params.owner_user_id);
  const qs = q.toString();
  return call(`/api/reminders${qs ? '?' + qs : ''}`, { method: 'GET' });
}

// Patients with reminders pending the caller's review (derived to me). Used to
// surface "to review" patients at the top of the list.
export async function getReviewQueue() {
  return call('/api/review-queue', { method: 'GET' });
}

// Resuelve la entidad de un recordatorio (episodio/paciente) → { patient_id,
// patient_name } para abrir su chat al hacer click en la notificación.
export async function resolveReminderPatient(entityId) {
  return call(`/api/review-queue/patient/${encodeURIComponent(entityId)}`, { method: 'GET' });
}

// Quién tiene "a cargo" a cada paciente (responsable del episodio más reciente).
export async function getPatientAssignments() {
  return call('/api/patient-assignments', { method: 'GET' });
}

export async function completeReminder(id, result) {
  return call(`/api/reminders/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    body: JSON.stringify(result ? { result } : {}),
  });
}

export function loadSessionId() {
  return localStorage.getItem('cepi.session_id') || null;
}

export function saveSessionId(id) {
  if (id) localStorage.setItem('cepi.session_id', id);
}

export async function chat(message, sessionId, extra = {}) {
  const body = { message };
  if (sessionId) body.session_id = sessionId;
  // Structured form submission ({ form_id, data }) — used by ficha sections.
  if (extra.formSubmission) body.form_submission = extra.formSubmission;
  try {
    return await call('/api/bot/chat', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    // Offline / network failure → queue the turn and flush on reconnect (PWA
    // offline send queue, TELEMEDICINA.md §6C). Only queue real connectivity
    // failures, not server-side 4xx/5xx.
    if (isNetworkError(e)) {
      enqueueOutbox(body);
      return {
        text: '📥 Sin conexión: tu mensaje quedó en cola y se enviará automáticamente al reconectar.',
        offline_queued: true,
      };
    }
    throw e;
  }
}

// ── Offline send queue (PWA) ──────────────────────────────────────────────
const OUTBOX_KEY = 'cepi.outbox';

function isNetworkError(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = String(e?.message || e || '');
  return /Failed to fetch|NetworkError|network|HTTP 0\b/i.test(m);
}

function readOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
}

function enqueueOutbox(body) {
  const q = readOutbox();
  q.push({ body, ts: Date.now() });
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
}

export function outboxSize() {
  return readOutbox().length;
}

/** Re-send every queued chat turn in order; keep the ones that still fail. */
export async function flushOutbox() {
  const q = readOutbox();
  if (!q.length) return 0;
  const remaining = [];
  for (const item of q) {
    try {
      await call('/api/bot/chat', { method: 'POST', body: JSON.stringify(item.body) });
    } catch (e) {
      if (isNetworkError(e)) remaining.push(item); // still offline — keep
      // a non-network error means the turn was processed/invalid: drop it
    }
  }
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  return q.length - remaining.length;
}

/** Wire the queue to flush whenever the browser regains connectivity. */
export function initOfflineQueue() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => { flushOutbox().catch(() => {}); });
  // Opportunistic flush on startup in case we came back online while closed.
  if (navigator.onLine) flushOutbox().catch(() => {});
}

export async function whoami() {
  return call('/api/auth/me', { method: 'GET' });
}

// El usuario edita su propio perfil (nombre, teléfono, cédula, contraseña).
// Devuelve { token, user } con el token reemitido (el nombre viaja en el JWT).
export async function updateProfile(patch) {
  const res = await call('/api/auth/me', { method: 'PATCH', body: JSON.stringify(patch) });
  if (res?.token) localStorage.setItem('cepi.jwt', res.token);
  return res;
}

// Multi-tenancy: organizaciones del usuario + cambio de org activa.
export async function listOrgs() {
  return call('/api/orgs', { method: 'GET' });
}
export async function switchOrg(orgId) {
  const res = await call('/api/orgs/switch', { method: 'POST', body: JSON.stringify({ org_id: orgId }) });
  if (res?.token) localStorage.setItem('cepi.jwt', res.token);  // nueva org activa
  return res;
}
/**
 * Cambia la org activa a la del registro indicado, si el usuario pertenece a ella.
 *
 * Un enlace no lleva la organización, y los datos scoped solo se leen desde la org
 * activa: abrirlo desde otra org daba 404 y una pantalla vacía sin explicación. Esto
 * NO hace visible nada entre organizaciones — la membresía la valida el servidor y
 * responde 403 a quien no pertenece. O el enlace cambia de org, o falla diciéndolo.
 *
 * Devuelve 'cambiada' | 'igual' | 'ajena' | 'error'. No lanza: es un reintento.
 */
export async function switchOrgToRecord(entityId, recordId) {
  let res;
  try {
    res = await call('/api/orgs/switch-to-record', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, record_id: recordId }),
    });
  } catch (e) {
    // 403 = pertenece a una org ajena. 404 = no existe, o no es visible para nadie
    // con esta cuenta; en ambos casos el registro sigue sin revelarse.
    return e?.status === 403 ? 'ajena' : 'error';
  }
  if (res?.sin_cambio) return 'igual';
  if (res?.token) { localStorage.setItem('cepi.jwt', res.token); return 'cambiada'; }
  return 'error';
}

/** Los mismos, atados a la definición que usa el portal. */
export const switchOrgToEpisodio = (id) => switchOrgToRecord(DEF_EPISODE, id);
export const switchOrgToPaciente = (id) => switchOrgToRecord(DEF_PATIENT, id);

export async function createOrg(slug, name) {
  return call('/api/orgs', { method: 'POST', body: JSON.stringify({ slug, name }) });
}
export async function updateOrg(id, patch) {
  return call(`/api/orgs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
}
export async function listOrgMembers(id) {
  return call(`/api/orgs/${encodeURIComponent(id)}/members`, { method: 'GET' });
}
export async function addOrgMember(id, userId, roleInOrg) {
  return call(`/api/orgs/${encodeURIComponent(id)}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId, role_in_org: roleInOrg }) });
}
export async function removeOrgMember(id, userId) {
  return call(`/api/orgs/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}
export async function listUsers() {
  return call('/api/security?type=user&active=all', { method: 'GET' });
}

// List patients (entity_definition 11000000-…) for the WhatsApp-style chat list.
// PII is redacted server-side per the caller's role.
export async function listPatients({ limit = 500 } = {}) {
  const params = new URLSearchParams({
    type: 'business',
    entity_id: '11000000-0000-0000-0000-000000000000',
    limit: String(limit),
  });
  return call(`/api/entities?${params.toString()}`, { method: 'GET' });
}

// Create a patient (contact). Schema requires only nombre; cédula is enforced
// client-side. Returns the created record { id, data, ... }.
export async function createPatient({ nombre, apellidos, cedula }) {
  const res = await call('/api/entities', {
    method: 'POST',
    body: JSON.stringify({
      record_type: 'business',
      entity_id: '11000000-0000-0000-0000-000000000000',
      title: `${nombre} ${apellidos}`.trim(),
      data: { nombre, apellidos, cedula },
      active: true,
    }),
  });
  return res?.data || res;
}

export async function loadBotSession(sessionId) {
  return call(`/api/bot/session/${encodeURIComponent(sessionId)}`, { method: 'GET' });
}

export async function listBotSessions(patientId) {
  const q = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : '';
  return call(`/api/bot/sessions${q}`, { method: 'GET' });
}

// Merged "group thread" for a patient: all clinicians' messages + the bot,
// chronological and attributed by author. Backed by TodoERP (cross-user read
// behind a patient-view gate) since the bot only sees the caller's own sessions.
export async function getPatientThread(patientId) {
  return call(`/api/patient-thread?patient_id=${encodeURIComponent(patientId)}`, { method: 'GET' });
}

/**
 * Fetch the clinical images of an episode plus their AI classifications.
 * Read-only; backed by cepi-bot's /api/bot/episode-images endpoint.
 */
/**
 * Galería de imágenes clínicas de la organización activa (PAPER §24.2.1): todas, o las de
 * un paciente. `q` busca por paciente, cédula, diagnóstico, CIE-10 o fecha.
 */
export async function galeria({ q = '', patientId = '', limit = 60, offset = 0 } = {}) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q.trim()) p.set('q', q.trim());
  if (patientId) p.set('patient_id', patientId);
  return call(`/api/bot/galeria?${p.toString()}`, { method: 'GET' });
}

/** Borrado suave de un paciente (D-Aux-23). Solo lo permite el backend a quien tiene el permiso. */
export async function eliminarPaciente(id) {
  return call(`/api/entities/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getEpisodeImages(episodeId) {
  return call(`/api/bot/episode-images?episode_id=${encodeURIComponent(episodeId)}`, { method: 'GET' });
}

/**
 * Fetch an attachment binary as an object URL. The /api/attachments/:id/file
 * endpoint needs a Bearer token, which a plain <img src> cannot carry — so we
 * fetch with auth headers and wrap the response in a blob URL. Callers must
 * revoke the URL when done.
 */
export async function fetchAttachmentObjectUrl(fileUrl) {
  const headers = {};
  const jwt = getJwt();
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(fileUrl, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Upload a single file to TodoERP /api/attachments. Optional entity_id
 * links the attachment to a record. Returns the attachment row.
 */
export async function uploadAttachment(file, { entityId, fieldKey } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  if (entityId) fd.append('entity_id', entityId);
  if (fieldKey) fd.append('field_key', fieldKey);

  const headers = {};
  const jwt = localStorage.getItem('cepi.jwt');
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

  const res = await fetch('/api/attachments', { method: 'POST', headers, body: fd });
  let body = null; try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return Array.isArray(body) ? body[0] : body;
}

/**
 * Ficha completa de un caso para el portal de casos: los 27 grupos en orden, cada
 * uno con su formulario prellenado y si tiene dato, más el conteo de faltantes.
 * Solo lectura y sin sesión de chat — el portal revisa, no llena (PAPER §22).
 */
export async function fichaCompleta({ episodeId = null, patientId = null } = {}) {
  const qs = new URLSearchParams();
  if (episodeId) qs.set('episode_id', episodeId);
  if (patientId) qs.set('patient_id', patientId);
  return call(`/api/bot/ficha?${qs.toString()}`);
}

const DEF_EPISODE = '12000000-0000-0000-0000-000000000000';
const DEF_PATIENT = '11000000-0000-0000-0000-000000000000';

/**
 * Casos (episodios) del portal, filtrados sobre columnas reales del ERP.
 * `origen` distingue lo espejado de DrPro de lo capturado en CEPI: el espejo deja
 * `drpro_cita_id`, así que su presencia (o ausencia) es el filtro (PAPER §22.3).
 */
export async function listarCasos({ q = '', codigo_cie10 = '', estado = '', desde = '', hasta = '', origen = '', deuda = '', orden = '-fecha', limit = 40, offset = 0 } = {}) {
  // El sort de la API usa el prefijo '-' para descendente, no 'campo:desc'.
  const p = new URLSearchParams({ type: 'business', entity_id: DEF_EPISODE, limit, offset, sort: orden || '-fecha' });
  if (q) p.set('q', q);
  if (codigo_cie10) p.set('filter[codigo_cie10][like]', codigo_cie10);
  if (estado) p.set('filter[estado]', estado);
  if (desde) p.set('filter[fecha][gte]', desde);
  if (hasta) p.set('filter[fecha][lte]', hasta);
  // Deuda de datos: el % vive materializado en el episodio (medical-seed 009) para
  // poder filtrarlo en SQL; calcularlo al vuelo serían 2 lecturas por caso listado.
  if (deuda) p.set('filter[ficha_completitud][lt]', deuda);
  if (origen === 'drpro') p.set('filter[drpro_cita_id][empty]', '0');
  if (origen === 'cepi') p.set('filter[drpro_cita_id][empty]', '1');
  return call(`/api/entities?${p.toString()}`);
}

/** Pacientes por id, en lote — para resolver los nombres de una lista de casos. */
export async function listarPacientes({ ids = [] } = {}) {
  if (!ids.length) return { data: [] };
  const p = new URLSearchParams({ type: 'business', entity_id: DEF_PATIENT, ids: ids.join(','), limit: String(ids.length) });
  return call(`/api/entities?${p.toString()}`);
}

/**
 * Guarda un grupo de la ficha desde el portal. Va por cepi-bot y no directo al ERP
 * a propósito: ahí viven las coerciones y los campos derivados (gravedad_total, BLINK)
 * que el chat aplica al guardar los mismos grupos. Escribir directo al ERP dejaría
 * fichas con los derivados a medias según por dónde se hubieran editado.
 */
/**
 * Guarda la ficha entera desde un formato documental. El reparto §1-§2 → paciente
 * y §3+ → episodio lo hace el backend, que es donde vive la lista de claves.
 */
export async function guardarFichaCompleta({ episodeId, patientId, data }) {
  return call('/api/bot/ficha/guardar', {
    method: 'POST',
    body: JSON.stringify({ episode_id: episodeId || null, patient_id: patientId || null, data }),
  });
}

export async function guardarGrupoFicha({ groupId, data, episodeId = null, patientId = null }) {
  return call('/api/bot/ficha/grupo', {
    method: 'POST',
    body: JSON.stringify({ group_id: groupId, data, episode_id: episodeId, patient_id: patientId }),
  });
}

/**
 * Pacientes para la pestaña de búsqueda por persona. `q` busca en todas las columnas
 * de texto (nombre, apellidos, cédula, ciudad…), que es lo que hace `?q=` en el ERP.
 */
export async function listarPacientesBusqueda({ q = '', origen = '', limit = 40, offset = 0 } = {}) {
  const p = new URLSearchParams({ type: 'business', entity_id: DEF_PATIENT, limit, offset, sort: 'apellidos' });
  if (q) p.set('q', q);
  if (origen === 'drpro') p.set('filter[drpro_id][empty]', '0');
  if (origen === 'cepi') p.set('filter[drpro_id][empty]', '1');
  return call(`/api/entities?${p.toString()}`);
}

/** Los episodios de un paciente, para abrir sus visitas desde su ficha. */
export async function listarCasosDePaciente(patientId) {
  const p = new URLSearchParams({
    type: 'business', entity_id: DEF_EPISODE, limit: '100', sort: '-fecha',
    'filter[patient_id]': patientId,
  });
  return call(`/api/entities?${p.toString()}`);
}

/**
 * Un registro por id. Se usa al abrir un caso por URL: la ruta trae el episodio pero
 * no de quién es, y sin el paciente no hay visitas hermanas que listar ni comparar.
 */
export async function obtenerEntidad(id) {
  const r = await call(`/api/entities/${id}`);
  return r?.data || r;
}
