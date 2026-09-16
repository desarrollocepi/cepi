<template>
  <div class="app">
    <PendingApproval v-if="authed && isPending" @logout="onLogout" />
    <template v-else>
    <header class="topbar">
      <div class="header-left">
        <img
          class="logo"
          src="/images/logo-cepi.png"
          alt="CEPI Centro de la Piel"
        />
      </div>
      <div class="header-center">
        <strong class="brand">{{ marca }}</strong>
      </div>
      <div class="header-right">
        <Notifications v-if="user && !isPending" :user="user" @open="onNotifOpen" />
        <button
          v-if="user && (showAdmin || showProfile || !chatHeadActive)" type="button" class="top-burger"
          @click="showTopMenu = !showTopMenu" aria-label="Opciones" :aria-expanded="showTopMenu"
        >☰</button>
        <span v-if="user" class="user" :class="{ open: showTopMenu }">
          <span class="user-id">{{ user.email }} · {{ user.role }}</span>
          <select
            v-if="user.orgs && user.orgs.length > 1"
            class="org-switch" :value="user.org_id" :disabled="orgSwitching"
            title="Organización activa" @change="onSwitchOrg($event.target.value)"
          >
            <option v-for="o in user.orgs" :key="o.id" :value="o.id">🏥 {{ o.name }}</option>
          </select>
          <span v-else-if="user.orgs && user.orgs.length === 1" class="org-chip" title="Organización">🏥 {{ user.orgs[0].name }}</span>
          <button v-if="canInstall" class="install-btn" @click="installApp" title="Instalar la app en tu dispositivo">📲 Instalar app</button>
          <button v-if="showNotifOptin && !isPending" class="notif-optin" @click="enableNotifs(); showTopMenu = false" title="Activar notificaciones push">🔔 Activar</button>
          <button v-if="!isPending && !showProfile" @click="openProfile">👤 Perfil</button>
          <button v-if="!isPending && !showCasos" @click="abrirCasos">🗂️ Casos</button>
          <button v-if="showCasos" @click="goChat">💬 Telemedicina</button>
          <button v-if="isAdmin && !showAdmin" @click="showTopMenu = false; $router.push('/admin')">Admin</button>
          <button v-if="showAdmin || showProfile" @click="goChat">Volver</button>
        </span>
      </div>
    </header>
    <div v-if="notifMsg" class="notif-toast" @click="notifMsg = ''">{{ notifMsg }}</div>
    <main>
      <!-- Sin sesión el login se pinta POR ENCIMA de la ruta, no como una ruta más:
           así el enlace a un caso sobrevive al login y se abre al entrar. -->
      <VerifyEmail v-if="view === 'verify'" :email="verifyEmailAddr" @done="goLogin" />
      <!-- Con un token guardado NO se pinta el login mientras se valida (recarga, cambio
           de org): verlo invitaba a volver a entrar con Google en cada refresco y eso
           agotaba el rate-limit de /auth/login y /auth/google. -->
      <div v-else-if="validando" class="sesion-estado">Abriendo tu sesión…</div>
      <div v-else-if="sinValidar" class="sesion-estado">
        <p>No se pudo validar tu sesión: {{ sinValidar }}</p>
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
        @head="chatHeadActive = $event" @back="goChat"
        @saved="onProfileSaved" @logout="onLogout"
      />
    </main>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
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

const user = ref(null);
const authed = ref(false);
const route = useRoute();
const router = useRouter();
// La vista la manda la RUTA: `showAdmin`/`showProfile`/`showCasos` eran tres banderas
// que había que mantener en sincronía a mano, y ninguna dejaba enlazar nada.
const showAdmin = computed(() => route.name === 'admin');
const showProfile = computed(() => route.name === 'perfil');
const showCasos = computed(() => String(route.name || '').startsWith('caso') || route.name === 'paciente');

// Portal de casos (PAPER §22): misma app, misma sesión, otra superficie. Se sirve en
// casos.cepi.ec, así que el host decide con qué vista arranca; el menú deja saltar de
// una a la otra sin volver a entrar.
const marca = computed(() => route.meta?.marca || 'Telemedicina');
function abrirCasos() { showTopMenu.value = false; router.push('/casos'); }
const showTopMenu = ref(false);          // burger de acciones del topbar (mobile)
const chatHeadActive = ref(false);       // el chat muestra su propio burger (paciente abierto)
// Si el chat toma el header, cierra el menú del topbar (su burger desaparece).
watch(chatHeadActive, (v) => { if (v) showTopMenu.value = false; });

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
function onNotifOpen({ id, name }) {
  // La notificación NAVEGA; ChatShell lee el paciente de la query al montar.
  router.push({ path: '/chat', query: { paciente: id, ...(name ? { nombre: name } : {}) } });
}
const isAdmin = computed(() => !!user.value?.permissions?.includes('*:*:*:*'));
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
const DEF_EPISODIO = '12000000-0000-0000-0000-000000000000';
const DEF_PACIENTE = '11000000-0000-0000-0000-000000000000';

async function abrirEntidadDePush(entityId) {
  if (!entityId) return;
  try {
    const rec = await obtenerEntidad(entityId);
    const defId = rec?.entity_id;
    if (defId === DEF_EPISODIO) {
      router.push({ name: 'caso', params: { episodeId: entityId } });
    } else if (defId === DEF_PACIENTE) {
      // Misma ruta que usa la campana de notificaciones, para no tener dos formas
      // distintas de "abrir un paciente desde una notificación".
      onNotifOpen({ id: entityId });
    }
  } catch { /* sin red o sin permiso: la app ya quedó abierta, que es lo mínimo */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('cepi:open-entity', (e) => abrirEntidadDePush(e.detail?.entityId));
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

// ── PWA: instalar la app (Add to Home Screen) ───────────────────────────────
// El navegador emite 'beforeinstallprompt' cuando la PWA es instalable; lo
// guardamos para dispararlo desde el botón. En iOS no existe ese evento → se
// muestra igual y se dan las instrucciones manuales.
const deferredInstall = ref(null);
const canInstall = computed(() => !isStandalone && (!!deferredInstall.value || isIosDevice));
// Registrar temprano (en setup, no en onMounted) para no perder el evento, que
// el navegador puede emitir apenas carga la página.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall.value = e; });
  window.addEventListener('appinstalled', () => { deferredInstall.value = null; flashNotif('App instalada ✔'); });
}
async function installApp() {
  showTopMenu.value = false;
  if (deferredInstall.value) {
    deferredInstall.value.prompt();
    try { await deferredInstall.value.userChoice; } catch { /* usuario canceló */ }
    deferredInstall.value = null;
    return;
  }
  if (isIosDevice) {
    flashNotif('En iPhone/iPad: toca Compartir → "Añadir a pantalla de inicio" para instalar la app.');
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

// Guarda de ruta: el botón de Admin se oculta a quien no lo es, pero la URL se
// puede teclear. Sin esto, un no-admin llegaba a /admin y veía una pantalla rota a
// base de 403 — el backend deniega bien, pero el usuario no entiende qué pasó.
watch([() => route.name, isAdmin, authed], ([nombre, admin, hayCuenta]) => {
  if (nombre === 'admin' && hayCuenta && !admin) router.replace(inicioSegunHost());
}, { immediate: true });

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
const validando = ref(!!localStorage.getItem('cepi.jwt'));
const sinValidar = ref('');

async function refresh() {
  if (!localStorage.getItem('cepi.jwt')) { authed.value = false; validando.value = false; return; }
  validando.value = true;
  sinValidar.value = '';
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
      sinValidar.value = e?.message || 'sin conexión con el servidor';
    }
  } finally {
    validando.value = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (sinValidar.value) refresh(); });
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
  sinValidar.value = '';
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
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 1.25rem;
  background: var(--accent-band);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #fff;
}
.header-left  { display: flex; align-items: center; }
.header-center { display: flex; align-items: center; justify-content: center; }
.header-right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
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
  flex: 1;
  min-height: 0;
  padding: 12px;
  width: 100%;
  overflow: hidden;
}

@media (max-width: 640px) {
  .topbar { padding: 0 0.75rem; }
  .user-id { display: none; }
  main { padding: 0; }

  /* Las acciones del topbar pasan a un menú desplegable (burger). */
  .header-right { position: relative; }
  .top-burger { display: inline-flex; align-items: center; justify-content: center; }
  .topbar .user {
    display: none;
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 90;
    flex-direction: column; align-items: stretch; gap: 6px;
    background: #fff; border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 12px 30px rgba(0,0,0,.28); padding: 8px; min-width: 210px; max-width: 84vw;
  }
  .topbar .user.open { display: flex; }
  /* Controles del menú: texto oscuro sobre blanco (ya no la banda del header). */
  .topbar .user .org-switch,
  .topbar .user button {
    color: var(--text); background: #fff; border: 1px solid var(--border);
    border-radius: 8px; text-align: left; width: 100%; max-width: none; padding: 8px 10px; font-weight: 600;
  }
  .topbar .user .org-switch option { color: var(--text); }
  .topbar .user button:hover { background: var(--bg); border-color: var(--border); }
  .topbar .user .org-chip { color: var(--text-muted); }
}
</style>
