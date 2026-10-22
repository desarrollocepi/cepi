<template>
  <div class="app">
    <PendingApproval v-if="authed && isPending" @logout="onLogout" />
    <template v-else>
    <header ref="topbarEl" class="topbar" :class="{ compact: topCompact }">
      <div class="header-left">
        <img
          class="logo"
          src="/images/logo-cepi.png"
          alt="CEPI Centro de la Piel"
        />
      </div>
      <div class="header-center">
        <strong class="brand">{{ brand }}</strong>
      </div>
      <div ref="headerRightEl" class="header-right">
        <Notifications v-if="user && !isPending" :user="user" @open="onNotifOpen" />
        <button
          v-if="user && (showProfile || !chatHeadActive)" type="button" class="top-burger"
          @click="showTopMenu = !showTopMenu" aria-label="Opciones" :aria-expanded="showTopMenu"
        >☰</button>
        <span v-if="user" ref="userEl" class="user" :class="{ open: showTopMenu }">
          <span class="user-id">{{ user.email }} · {{ user.role }}</span>
          <select
            v-if="user.orgs && user.orgs.length > 1"
            class="org-switch" :value="user.org_id" :disabled="orgSwitching"
            title="Organización activa" @change="onSwitchOrg($event.target.value)"
          >
            <option v-for="o in user.orgs" :key="o.id" :value="o.id">🏥 {{ o.name }}</option>
          </select>
          <span v-else-if="user.orgs && user.orgs.length === 1" class="org-chip" title="Organización">🏥 {{ user.orgs[0].name }}</span>
          <button v-if="canInstall" class="install-btn" @click="installApp" :title="storeUrl ? 'Descargar la app de la tienda' : 'Instalar la app en tu dispositivo'">📲 Instalar app</button>
          <button v-if="showNotifOptin && !isPending" class="notif-optin" @click="enableNotifs(); showTopMenu = false" title="Activar notificaciones push">🔔 Activar</button>
          <button v-if="!isPending && !showProfile" @click="openProfile">👤 Perfil</button>
          <button v-if="!isPending && !showCases" @click="openCases">🗂️ Casos</button>
          <button v-if="!isPending && !showGallery" @click="openGallery">🖼️ Galería</button>
          <button v-if="showCases" @click="goChat">💬 Telemedicina</button>
          <!-- La administración vive en console.cepi.ec, no acá (PAPER §26). El botón
               se queda: es el camino conocido. Quien no administra nada lo ve
               deshabilitado con el motivo, no un hueco. -->
          <button
            :disabled="!isAdmin"
            :title="isAdmin ? 'Abrir la consola de administración en otra pestaña' : 'Solo el superadministrador o el admin de una organización'"
            @click="openConsole"
          >Admin ↗</button>
          <button v-if="showProfile" @click="goChat">Volver</button>
        </span>
      </div>
    </header>
    <div v-if="notifMsg" class="notif-toast" @click="notifMsg = ''">{{ notifMsg }}</div>
    <main>
      <!-- Sin sesión el login se pinta POR ENCIMA de la ruta, no como una ruta más:
           así el enlace a un caso sobrevive al login y se abre al entrar. -->
      <!-- Cambiar de org recarga la página; hasta que termina, la lista de la org anterior
           seguía a la vista y se podía tocar como si fuera la nueva. -->
      <div v-if="orgSwitching" class="org-cambiando" role="status"><span class="org-spin" />Cambiando de organización…</div>
      <VerifyEmail v-if="view === 'verify'" :email="verifyEmailAddr" @done="goLogin" />
      <!-- Con un token guardado NO se pinta el login mientras se valida (recarga, cambio
           de org): verlo invitaba a volver a entrar con Google en cada refresco y eso
           agotaba el rate-limit de /auth/login y /auth/google. -->
      <div v-else-if="validating" class="sesion-estado">Abriendo tu sesión…</div>
      <div v-else-if="validationError" class="sesion-estado">
        <p>No se pudo validar tu sesión: {{ validationError }}</p>
        <p>Tu sesión sigue abierta; no hace falta volver a ingresar.</p>
        <div class="sesion-acciones">
          <button type="button" @click="refresh">Reintentar</button>
          <button type="button" class="secundario" @click="onLogout">Cerrar sesión</button>
        </div>
      </div>
      <template v-else-if="!authed">
        <Register v-if="view === 'register'" @go-login="view = 'login'" @registered="onRegistered" />
        <Login v-else @logged-in="onLoggedIn" @go-register="view = 'register'" />
      </template>
      <!-- Sin `ref` sobre el componente: con vistas cargadas de forma diferida, un
           template ref sobre `<component :is>` revienta el hidratado de Vue. Lo que
           lo necesitaba —abrir un paciente desde una notificación— ahora viaja por
           la propia ruta, que además deja el enlace compartible. -->
      <RouterView
        v-else :user="user"
        @head="chatHeadActive = $event" @back="goChat" @aviso="flashNotif"
        @saved="onProfileSaved" @logout="onLogout"
      />
    </main>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import Login from './components/Login.vue';
import Register from './components/Register.vue';
import VerifyEmail from './components/VerifyEmail.vue';
import PendingApproval from './components/PendingApproval.vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { inicioSegunHost } from './router.js';
import Notifications from './components/Notifications.vue';
import { whoami, logout, switchOrg, obtenerEntidad } from './api.js';
import { enableWebPush } from './pwa.js';
import { bindBackState } from './useBackStack.js';
import { Capacitor } from '@capacitor/core';
import { PLAY_URL, APP_STORE_URL } from './tiendas.js';

const user = ref(null);
const authed = ref(false);
const route = useRoute();
const router = useRouter();
// La vista la manda la RUTA: `showProfile`/`showCasos` eran banderas que había que
// mantener en sincronía a mano, y ninguna dejaba enlazar nada.
const showProfile = computed(() => route.name === 'perfil');
const showCases = computed(() => String(route.name || '').startsWith('caso') || route.name === 'paciente');
const showGallery = computed(() => route.name === 'galeria');

// Portal de casos (PAPER §22): misma app, misma sesión, otra superficie. Se sirve en
// casos.cepi.ec, así que el host decide con qué vista arranca; el menú deja saltar de
// una a la otra sin volver a entrar.
const brand = computed(() => route.meta?.marca || 'Telemedicina');
function openCases() { showTopMenu.value = false; router.push('/casos'); }
function openGallery() { showTopMenu.value = false; router.push('/galeria'); }
const showTopMenu = ref(false);          // burger de acciones del topbar (mobile)
const chatHeadActive = ref(false);       // el chat muestra su propio burger (paciente abierto)
// Si el chat toma el header, cierra el menú del topbar (su burger desaparece).
watch(chatHeadActive, (v) => { if (v) showTopMenu.value = false; });

// Las acciones pasan al burger cuando no caben, no por un ancho fijo: en tablet
// (641–1280 px) se salían del topbar. Solo se puede medir con la fila a la vista,
// así que el ancho que pidió queda guardado para saber cuándo vuelve a caber.
const topbarEl = ref(null);
const headerRightEl = ref(null);
const userEl = ref(null);
const topCompact = ref(false);
let actionsWidth = 0;
function naturalWidth(el) {
  const children = [...el.children].filter((child) => child.offsetWidth > 0);
  const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
  return children.reduce((t, child) => t + child.offsetWidth, 0) + gap * Math.max(0, children.length - 1);
}
// Lo que queda para las acciones: el topbar menos su padding, el logo y la marca.
function availableWidth() {
  const tb = topbarEl.value;
  const cs = getComputedStyle(tb);
  const gap = parseFloat(cs.columnGap) || 0;
  const [left, center] = tb.children;
  const brandWidth = center?.firstElementChild?.offsetWidth || 0;
  return tb.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
    - (left?.offsetWidth || 0) - brandWidth - 2 * gap;
}
function measureTopbar() {
  const right = headerRightEl.value;
  if (!right || !topbarEl.value) return;
  if (window.innerWidth <= 640) { topCompact.value = true; return; }
  if (topCompact.value) {
    // Con el burger puesto la fila no se ve: se compara con lo que pidió la última vez.
    if (actionsWidth && availableWidth() >= actionsWidth) { topCompact.value = false; nextTick(measureTopbar); }
    return;
  }
  if (!userEl.value) return;
  actionsWidth = naturalWidth(right) - userEl.value.offsetWidth + naturalWidth(userEl.value);
  if (actionsWidth > availableWidth()) { topCompact.value = true; showTopMenu.value = false; }
}
// Cambian los botones (ruta, sesión, org) → volver a medir desde la fila completa.
function remeasureTopbar() {
  if (window.innerWidth > 640) topCompact.value = false;
  nextTick(measureTopbar);
}
let topbarObserver = null;
onMounted(() => {
  // En onMounted: `deferredInstall` y `notifPerm` se declaran más abajo.
  watch(() => [route.fullPath, user.value, chatHeadActive.value, deferredInstall.value, notifPerm.value], remeasureTopbar);
  if (typeof ResizeObserver !== 'undefined' && topbarEl.value) {
    topbarObserver = new ResizeObserver(() => measureTopbar());
    topbarObserver.observe(topbarEl.value);
  }
  window.addEventListener('resize', measureTopbar);
  nextTick(measureTopbar);
});
onUnmounted(() => { topbarObserver?.disconnect(); window.removeEventListener('resize', measureTopbar); });

function openProfile() {
  showTopMenu.value = false;
  router.push('/perfil');
}
// "Volver" siempre lleva al chat (cierra Admin/Perfil y el menú).
function goChat() {
  // "Volver" siempre lleva a la superficie con la que arranca este dominio.
  showTopMenu.value = false;
  router.push(inicioSegunHost());
}
function onProfileSaved(u) {
  // El perfil devolvió el user actualizado (nombre/teléfono/cédula) → refrescar.
  if (u) user.value = { ...user.value, ...u };
}
// Click en una notificación → ir al chat y abrir el paciente que la origina.
function onNotifOpen({ id }) {
  // La notificación NAVEGA a la URL del paciente; ChatShell lo abre desde la ruta y
  // resuelve el nombre por id (no viaja en la URL: es dato personal).
  if (id) router.push({ name: 'chat-paciente', params: { patientId: id } });
}
// Superadmin, o admin de alguna organización: administra a la gente de sus orgs
// (`/api/admin/*` acota el alcance). El botón vive en el menú de la cuenta.
const isAdmin = computed(() =>
  !!user.value?.permissions?.includes('*:*:*:*') ||
  (user.value?.orgs || []).some(o => o.role_in_org === 'admin'));

/** La consola es otra app, en otro dominio y con su propio repo (PAPER §26). Se
 *  abre en una pestaña nueva: administrar no es una escala del camino clínico, y
 *  volver no debería costar perder el paciente abierto.
 *
 *  El host se deriva del actual para que el mismo build sirva en prod, en
 *  develop y en local sin variable de entorno. En local (sin dominio) apunta a
 *  la consola en :5175. */
function openConsole() {
  showTopMenu.value = false;
  const h = location.hostname;
  const target = /^(casos|telemedicina)\./i.test(h)
    ? `${location.protocol}//console.${h.replace(/^[^.]+\./, '')}`
    : (h === 'localhost' || h === '127.0.0.1' ? 'http://localhost:5175' : 'https://console.cepi.ec');
  window.open(target, '_blank', 'noopener');
}
const isPending = computed(() => authed.value && user.value?.role === 'pendiente');

// ── Notificaciones push (opt-in) ────────────────────────────────────────────
const notifPerm = ref(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
const notifMsg = ref('');
let notifTimer = null;
const isIosDevice = /iphone|ipad|ipod/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
const isStandalone = typeof window !== 'undefined'
  && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
// Mostrar "Activar" mientras no esté concedido (y no sea iOS sin instalar, donde primero hay que instalar).
const showNotifOptin = computed(() => !!user.value && notifPerm.value !== 'granted');
function flashNotif(m) { notifMsg.value = m; if (notifTimer) clearTimeout(notifTimer); notifTimer = setTimeout(() => { notifMsg.value = ''; }, 7000); }

// Push que llega con la app ABIERTA. Android no la dibuja en ese caso —se la
// entrega a la app— así que el aviso lo damos acá: vibración (en push.js) más
// este toast. Solo vibrar dejaría al usuario mirando la pantalla sin saber por
// qué vibró.
if (typeof window !== 'undefined') {
  window.addEventListener('cepi:push-en-primer-plano', (e) => {
    const { title, body } = e.detail || {};
    flashNotif([title, body].filter(Boolean).join(' — '));
  });
}

/**
 * Tap en la notificación → abrir lo que la originó.
 *
 * La push trae el `entity_id` del recordatorio, que es GENÉRICO: puede ser un
 * episodio, un paciente o cualquier otra entidad. Por eso hay que preguntar de
 * qué tipo es antes de decidir a dónde ir, en vez de asumir. Si no se puede
 * resolver, se abre la app y ya — mejor eso que navegar a una pantalla vacía.
 */
const EPISODE_DEF_ID = '12000000-0000-0000-0000-000000000000';
const PATIENT_DEF_ID = '11000000-0000-0000-0000-000000000000';

async function openPushEntity(entityId) {
  if (!entityId) return;
  try {
    const record = await obtenerEntidad(entityId);
    const defId = record?.entity_id;
    if (defId === EPISODE_DEF_ID) {
      router.push({ name: 'caso', params: { episodeId: entityId } });
    } else if (defId === PATIENT_DEF_ID) {
      // Misma ruta que usa la campana de notificaciones, para no tener dos formas
      // distintas de "abrir un paciente desde una notificación".
      onNotifOpen({ id: entityId });
    }
  } catch { /* sin red o sin permiso: la app ya quedó abierta, que es lo mínimo */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('cepi:open-entity', (e) => openPushEntity(e.detail?.entityId));
}
async function enableNotifs() {
  if (isIosDevice && !isStandalone) {
    flashNotif('En iPhone/iPad: toca Compartir → "Añadir a pantalla de inicio", abre la app desde el ícono y vuelve a tocar "Activar".');
    return;
  }
  const msg = await enableWebPush();
  notifPerm.value = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  flashNotif(msg);
}

// ── Instalar la app ─────────────────────────────────────────────────────────
// En el teléfono, la app es la de la tienda: Play en Android, App Store en
// iPhone/iPad. La PWA (Add to Home Screen) queda solo para el escritorio: el
// navegador emite 'beforeinstallprompt' cuando es instalable y lo guardamos
// para dispararlo desde el botón. Dentro de la app nativa no se ofrece nada.
const isAndroidDevice = /android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
const storeUrl = isIosDevice ? APP_STORE_URL : isAndroidDevice ? PLAY_URL : null;
const deferredInstall = ref(null);
const canInstall = computed(() => !isStandalone && !Capacitor.isNativePlatform() && (!!storeUrl || !!deferredInstall.value));
// Registrar temprano (en setup, no en onMounted) para no perder el evento, que
// el navegador puede emitir apenas carga la página.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall.value = e; });
  window.addEventListener('appinstalled', () => { deferredInstall.value = null; flashNotif('App instalada ✔'); });
}
async function installApp() {
  showTopMenu.value = false;
  if (storeUrl) {
    window.open(storeUrl, '_blank', 'noopener');
    return;
  }
  if (deferredInstall.value) {
    deferredInstall.value.prompt();
    try { await deferredInstall.value.userChoice; } catch { /* usuario canceló */ }
    deferredInstall.value = null;
  }
}
// Ruteo liviano (sin vue-router). La verificación es por CÓDIGO (no por link):
// tras registrarse se pasa a la vista 'verify' con el email.
const verifyEmailAddr = ref('');
const view = ref('login');

function onRegistered(email) {
  verifyEmailAddr.value = email;
  view.value = 'verify';
}
function goLogin() {
  verifyEmailAddr.value = '';
  view.value = 'login';
}

// Device/browser Back navigates within the app (register/verify/admin) instead
// of leaving the page. The chat list↔detail Back is handled inside ChatShell.
bindBackState(() => view.value === 'register', () => { view.value = 'login'; });
bindBackState(() => view.value === 'verify', () => { goLogin(); });
// El atrás dentro de /admin ya lo maneja el router: cada navegación es una entrada
// del historial. `bindBackState` sigue haciendo falta para register/verify, que se
// pintan por encima de la ruta y no pasan por él.
// Tema claro fijo por ahora (se quitó el toggle de modo oscuro).
document.documentElement.dataset.theme = 'light';

// `validando` arranca en true si hay token: el primer render ya es "Abriendo tu sesión…"
// y no un destello del formulario de login.
const validating = ref(!!localStorage.getItem('cepi.jwt'));
const validationError = ref('');

async function refresh() {
  if (!localStorage.getItem('cepi.jwt')) { authed.value = false; validating.value = false; return; }
  validating.value = true;
  validationError.value = '';
  try {
    const r = await whoami();
    // Conservar/renovar el token en cada carga (sesión deslizante): así el
    // refresco NO fuerza un re-login y no se golpea el rate-limit de /login.
    if (r?.token) localStorage.setItem('cepi.jwt', r.token);
    user.value = r?.user || null;
    authed.value = !!user.value;
  } catch (e) {
    if (e?.status === 401) {
      // Solo un 401 dice que el token ya no sirve (vencido, usuario inactivo).
      logout();
      user.value = null;
      authed.value = false;
    } else {
      // Sin red, 5xx o 429: el token puede seguir siendo válido. Mandar al login
      // acá era lo que hacía volver a entrar y saturaba los intentos.
      validationError.value = e?.message || 'sin conexión con el servidor';
    }
  } finally {
    validating.value = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (validationError.value) refresh(); });
}

function onLoggedIn() {
  refresh();
}

// Cambiar de organización activa → reemite token y recarga (refetch por org).
const orgSwitching = ref(false);
async function onSwitchOrg(orgId) {
  if (!orgId || orgId === user.value?.org_id || orgSwitching.value) return;
  orgSwitching.value = true;
  try { await switchOrg(orgId); window.location.reload(); }
  catch (e) { orgSwitching.value = false; flashNotif('No se pudo cambiar de organización.'); }
}

function onLogout() {
  logout();
  user.value = null;
  authed.value = false;
  validationError.value = '';
  router.push(inicioSegunHost());
}

onMounted(refresh);
</script>

<style>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
}
.topbar {
  width: 100%;
  height: var(--header-h);
  flex-shrink: 0;
  display: grid;
  /* Las acciones se quedan con todo el ancho que dejan el logo y la marca. Con
     `1fr auto 1fr` solo tenían media pantalla y no cabían ni en un escritorio de 1920. */
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 0 1.25rem;
  /* El backdrop-filter hace del topbar un contexto de apilamiento: sin z-index propio,
     el `main` (position: relative) se pintaba encima y tapaba el panel de notificaciones. */
  position: relative;
  z-index: 100;
  background: var(--accent-band);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #fff;
}
.header-left  { display: flex; align-items: center; }
.header-center { min-width: 0; display: flex; align-items: center; justify-content: center; }
.header-right { position: relative; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.header-right > *, .topbar .user > * { flex-shrink: 0; white-space: nowrap; }
.org-switch { border: 1px solid rgba(255,255,255,.55); background: rgba(255,255,255,.15); color: #fff; border-radius: 14px; padding: 4px 10px; font-size: 0.82rem; font-weight: 600; cursor: pointer; max-width: 200px; }
.org-switch option { color: #1e293b; }
.org-chip { font-size: 0.8rem; font-weight: 600; opacity: .9; white-space: nowrap; }
.admin-wrap { height: 100%; overflow: auto; }
.admin-tabs { display: flex; gap: 8px; padding: 12px 16px 0; }
.admin-tabs button { border: 1px solid var(--border); background: #fff; color: var(--text); border-radius: 8px 8px 0 0; padding: 8px 16px; font-weight: 600; cursor: pointer; }
.admin-tabs button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.install-btn { border: 1px solid #34d399; background: #d1fae5; color: #065f46; border-radius: 16px; padding: 4px 12px; font-weight: 700; font-size: 0.82rem; cursor: pointer; white-space: nowrap; }
.install-btn:hover { background: #a7f3d0; }
.notif-optin { border: 1px solid #facc15; background: #fef9c3; color: #854d0e; border-radius: 16px; padding: 4px 12px; font-weight: 700; font-size: 0.82rem; cursor: pointer; white-space: nowrap; }
.notif-optin:hover { background: #fde68a; }
.notif-toast {
  position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 1200;
  max-width: min(520px, 92vw); background: #1e293b; color: #fff; border-radius: 10px;
  padding: 12px 16px; font-size: 0.88rem; line-height: 1.4; box-shadow: 0 10px 30px rgba(0,0,0,.35); cursor: pointer;
}

.sesion-estado {
  max-width: 360px; margin: 60px auto; padding: 24px; text-align: center;
  color: var(--text-muted); display: flex; flex-direction: column; gap: 8px;
}
.sesion-estado p { margin: 0; }
.sesion-acciones { display: flex; gap: 8px; justify-content: center; margin-top: 8px; }
.sesion-acciones button {
  padding: 8px 14px; border-radius: 4px; font-weight: 600; cursor: pointer;
  background: var(--accent); color: #fff; border: 1px solid var(--accent);
}
.sesion-acciones button.secundario { background: #fff; color: var(--text); border-color: var(--border); }

.org-cambiando {
  position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
  gap: 10px; font-weight: 600; color: var(--text); background: rgba(255,255,255,.82);
}
.org-spin { width: 16px; height: 16px; border: 2px solid #cbd5e1; border-top-color: var(--accent); border-radius: 50%; animation: org-giro .7s linear infinite; }
@keyframes org-giro { to { transform: rotate(360deg); } }

.logo { height: 38px; object-fit: contain; display: block; }
.brand { color: #fff; letter-spacing: 0.02em; font-size: 1rem; }

.topbar .user {
  display: flex; gap: 10px; align-items: center;
  font-size: 0.82rem; color: #fff;
}
/* Burger de acciones del topbar — solo móvil. */
.top-burger {
  display: none; flex-shrink: 0;
  border: 1.5px solid rgba(255,255,255,.45); background: rgba(255,255,255,.18); color: #fff;
  border-radius: 8px; width: 34px; height: 32px; font-size: 1.05rem; line-height: 1; cursor: pointer;
}
.top-burger:hover { background: rgba(255,255,255,.3); }
.user-id { opacity: 0.92; }
.topbar .user button {
  background: rgba(255,255,255,0.18);
  color: #fff;
  border: 1.5px solid rgba(255,255,255,0.45);
  padding: 0.3rem 0.85rem;
  border-radius: 20px;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.01em;
  transition: background 0.2s, border-color 0.2s;
}
.topbar .user button:hover {
  background: rgba(255,255,255,0.30);
  border-color: rgba(255,255,255,0.7);
}

main {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 12px;
  width: 100%;
  overflow: hidden;
}

/* El correo es lo primero que se va: así en una tablet apaisada los botones caben en la fila. */
@media (max-width: 1440px) { .user-id { display: none; } }

@media (max-width: 640px) {
  .topbar { padding: 0 0.75rem; }
  main { padding: 0; }
}

/* Las acciones del topbar pasan a un menú desplegable (burger) cuando no caben en la
   fila: en el teléfono siempre, en la tablet según los botones que haya (measureTopbar). */
.topbar.compact .user-id { display: none; }
.topbar.compact .top-burger { display: inline-flex; align-items: center; justify-content: center; }
.topbar.compact .user {
  display: none;
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 90;
  flex-direction: column; align-items: stretch; gap: 6px;
  background: #fff; border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0,0,0,.28); padding: 8px; min-width: 210px; max-width: 84vw;
}
.topbar.compact .user.open { display: flex; }
/* Controles del menú: texto oscuro sobre blanco (ya no la banda del header). */
.topbar.compact .user .org-switch,
.topbar.compact .user button {
  color: var(--text); background: #fff; border: 1px solid var(--border);
  border-radius: 8px; text-align: left; width: 100%; max-width: none; padding: 8px 10px; font-weight: 600;
}
.topbar.compact .user .org-switch option { color: var(--text); }
.topbar.compact .user button:hover { background: var(--bg); border-color: var(--border); }
.topbar.compact .user .org-chip { color: var(--text-muted); }
.topbar.compact .user button:disabled { opacity: .55; cursor: not-allowed; }
</style>
