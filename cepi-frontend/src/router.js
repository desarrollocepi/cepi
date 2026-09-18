/**
 * Rutas de la app médica.
 *
 * HASH Y NO HISTORY, a propósito: esto corre también como app nativa Android
 * (Capacitor), donde no hay servidor que reescriba las rutas — con `history` una
 * recarga o un enlace profundo darían 404. Con hash funciona igual en el navegador
 * y en el APK, y la URL sigue siendo compartible:
 *   https://casos.cepi.ec/#/casos/caso/<id>
 *
 * El portal de casos y telemedicina son dos superficies de la MISMA app (PAPER §22),
 * así que comparten router: `/chat` y `/casos` son ramas, no aplicaciones distintas.
 */
import { createRouter, createWebHashHistory } from 'vue-router';

// Importaciones DIRECTAS y no diferidas: con componentes async, Vue entra en su
// camino de hidratación y revienta con `locateNonHydratedAsyncRoot`. La app es
// pequeña y ya carga entera hoy; partir el bundle no vale una pantalla en blanco.
import ChatShell from './components/ChatShell.vue';
import CasosShell from './components/CasosShell.vue';
import Profile from './components/Profile.vue';
import AdminShell from './components/AdminShell.vue';
import Galeria from './components/Galeria.vue';

/** Con qué arranca quien entra sin ruta: lo decide el dominio por el que llegó. */
export function inicioSegunHost() {
  const enCasos = typeof location !== 'undefined' && /^casos\./i.test(location.hostname);
  return enCasos ? '/casos' : '/chat';
}

const routes = [
  { path: '/', redirect: () => inicioSegunHost() },
  { path: '/chat', name: 'chat', component: ChatShell, meta: { auth: true, marca: 'Telemedicina' } },
  { path: '/casos', name: 'casos', component: CasosShell, meta: { auth: true, marca: 'Casos' } },
  // El caso y el paciente son la MISMA vista con distinto foco: el shell lee los
  // params. Rutas separadas y no una con query para que el enlace se lea solo.
  { path: '/casos/caso/:episodeId', name: 'caso', component: CasosShell, props: true, meta: { auth: true, marca: 'Casos' } },
  { path: '/casos/paciente/:patientId', name: 'paciente', component: CasosShell, props: true, meta: { auth: true, marca: 'Casos' } },
  { path: '/galeria', name: 'galeria', component: Galeria, meta: { auth: true, marca: 'Galería' } },
  { path: '/perfil', name: 'perfil', component: Profile, meta: { auth: true, marca: 'Mi perfil' } },
  { path: '/admin', name: 'admin', component: AdminShell, meta: { auth: true, admin: true, marca: 'Admin' } },
  // Sin sesión no hay ruta propia: el login lo pinta App.vue por encima de todo. Se
  // deja el catch-all para que una URL vieja o mal escrita no deje la pantalla vacía.
  { path: '/:pathMatch(.*)*', redirect: () => inicioSegunHost() },
];

export const router = createRouter({ history: createWebHashHistory(), routes });
export default router;
