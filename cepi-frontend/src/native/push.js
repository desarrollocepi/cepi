// Push NATIVO (FCM/APNs) para las apps iOS/Android. No-op en web (el web sigue
// con Web Push / VAPID por el service worker). Registra el token FCM en el
// backend (device_tokens) con el JWT de la sesión.
import { Capacitor } from '@capacitor/core';
import { API_BASE, isNative } from './index.js';

function getJwt() {
  return (typeof localStorage !== 'undefined' && localStorage.getItem('cepi.jwt')) || null;
}

async function sendToken(token) {
  const jwt = getJwt();
  if (!jwt || !token) return;
  try {
    await fetch(`${API_BASE}/api/push/device-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ platform: Capacitor.getPlatform(), token }),
    });
  } catch { /* reintenta en el próximo arranque */ }
}

/**
 * Vibra por la API web, no por un plugin nativo: `navigator.vibrate` funciona en
 * el WebView de Android y en la PWA, así que no obliga a agregar dependencia ni a
 * recompilar y reinstalar la APK.
 *
 * Vibrar y no sonar: la app se usa en consulta, con el paciente delante.
 *
 * El patrón es corto-pausa-corto para que no se confunda con una llamada.
 */
function vibrar() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 60, 120]);
    }
  } catch { /* el navegador puede negarlo sin avisar; no es motivo de error */ }
}

let started = false;
export async function initNativePush() {
  if (!isNative() || started) return;
  started = true;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return;
    const { token } = await FirebaseMessaging.getToken();
    await sendToken(token);
    // Rotación del token.
    await FirebaseMessaging.addListener('tokenReceived', (e) => sendToken(e?.token));
    // Tap en la notificación → llevar al chat del paciente que la origina.
    await FirebaseMessaging.addListener('notificationActionPerformed', (e) => {
      const entityId = e?.notification?.data?.entity_id;
      if (entityId) window.dispatchEvent(new CustomEvent('cepi:open-entity', { detail: { entityId } }));
    });

    // Con la app ABIERTA, Android no dibuja la notificación: se la entrega a la
    // app y espera que ella avise. Sin este listener el mensaje llegaba y no
    // pasaba absolutamente nada, que es justo cuando el usuario está mirando la
    // pantalla y más fácil es perdérselo.
    await FirebaseMessaging.addListener('notificationReceived', (e) => {
      const n = e?.notification || {};
      vibrar();
      window.dispatchEvent(new CustomEvent('cepi:push-en-primer-plano', {
        detail: {
          title: n.title || 'CEPI',
          body: n.body || '',
          entityId: n.data?.entity_id || null,
        },
      }));
    });
  } catch (err) {
    console.warn('[native-push] init falló:', err?.message || err);
  }
}

export async function unregisterNativePush() {
  if (!isNative()) return;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    const { token } = await FirebaseMessaging.getToken();
    const jwt = getJwt();
    if (jwt && token) {
      await fetch(`${API_BASE}/api/push/device-token`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ token }),
      });
    }
    await FirebaseMessaging.deleteToken();
  } catch { /* nada que limpiar */ }
  started = false;
}
