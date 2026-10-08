import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { h, defineComponent } from 'vue';

vi.mock('../src/api.js', () => ({ whoami: vi.fn(), logout: vi.fn(), switchOrg: vi.fn(), obtenerEntidad: vi.fn() }));
vi.mock('../src/pwa.js', () => ({ enableWebPush: vi.fn() }));
vi.mock('../src/router.js', () => ({ inicioSegunHost: () => '/chat' }));
import * as api from '../src/api.js';
import { enableWebPush } from '../src/pwa.js';
import App from '../src/App.vue';

const doble = (name, emits = [], props = []) => defineComponent({ name, props, emits, render: () => h('div', { class: 'd-' + name }) });
const Login = doble('Login', ['logged-in', 'go-register']);
const Register = doble('Register', ['go-login', 'registered']);
const VerifyEmail = doble('VerifyEmail', ['done'], ['email']);
const PendingApproval = doble('PendingApproval', ['logout']);
const Notifications = doble('Notifications', ['open'], ['user']);
const Pantalla = doble('Pantalla', ['head', 'back', 'aviso', 'saved', 'logout'], ['user']);

const USUARIO = { id: 'u1', email: 'ana@cepi.ec', role: 'medico_primario', org_id: 'o1', permissions: [], orgs: [{ id: 'o1', name: 'CEPI Telemedicina' }, { id: 'o2', name: 'CEPI Consultorio' }] };

async function montar({ ruta = '/chat', token = 'tok' } = {}) {
  if (token) localStorage.setItem('cepi.jwt', token);
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/chat', name: 'chat', component: Pantalla, meta: { marca: 'Telemedicina' } },
    { path: '/chat/:patientId', name: 'chat-paciente', component: Pantalla, meta: { marca: 'Telemedicina' } },
    { path: '/casos', name: 'casos', component: Pantalla, meta: { marca: 'Casos' } },
    { path: '/casos/caso/:episodeId', name: 'caso', component: Pantalla, meta: { marca: 'Casos' } },
    { path: '/galeria', name: 'galeria', component: Pantalla, meta: { marca: 'Galería' } },
    { path: '/perfil', name: 'perfil', component: Pantalla, meta: { marca: 'Mi perfil' } },
  ] });
  await router.push(ruta);
  const w = mount(App, { global: { plugins: [router], stubs: { Login, Register, VerifyEmail, PendingApproval, Notifications } } });
  await flushPromises();
  return { w, router };
}
const boton = (w, texto) => w.findAll('.user button').find((b) => b.text().includes(texto));

let recargas;
beforeEach(() => {
  vi.useFakeTimers();
  recargas = 0;
  Object.defineProperty(window, 'location', { value: { hostname: 'telemedicina.cepi.ec', protocol: 'https:', reload: () => { recargas++; } }, configurable: true, writable: true });
  api.whoami.mockResolvedValue({ token: 'renovado', user: USUARIO });
  api.logout.mockImplementation(() => { localStorage.removeItem('cepi.jwt'); });
});
afterEach(() => { vi.useRealTimers(); });

describe('App — sesión', () => {
  it('sin token muestra el ingreso y no consulta al servidor', async () => {
    const { w } = await montar({ token: null });
    expect(w.findComponent(Login).exists()).toBe(true);
    expect(api.whoami).not.toHaveBeenCalled();
    expect(w.findComponent(Pantalla).exists()).toBe(false);
  });

  it('con token valida la sesión, guarda el token renovado y entra', async () => {
    const { w } = await montar();
    expect(localStorage.getItem('cepi.jwt')).toBe('renovado');
    expect(w.findComponent(Pantalla).props('user')).toEqual(USUARIO);
    expect(w.find('.user-id').text()).toBe('ana@cepi.ec · medico_primario');
    expect(w.find('.brand').text()).toBe('Telemedicina');
  });

  it('mientras valida NO pinta el ingreso: dice "Abriendo tu sesión…"', async () => {
    api.whoami.mockReturnValue(new Promise(() => {}));
    const { w } = await montar();
    expect(w.find('.sesion-estado').text()).toBe('Abriendo tu sesión…');
    expect(w.findComponent(Login).exists()).toBe(false);
  });

  it('un 401 cierra la sesión y lleva al ingreso', async () => {
    api.whoami.mockRejectedValue(Object.assign(new Error('expirada'), { status: 401 }));
    const { w } = await montar();
    expect(api.logout).toHaveBeenCalled();
    expect(w.findComponent(Login).exists()).toBe(true);
  });

  it('un fallo que no es 401 (sin red, 503) NO cierra la sesión: ofrece reintentar', async () => {
    api.whoami.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }));
    const { w } = await montar();
    expect(api.logout).not.toHaveBeenCalled();
    expect(localStorage.getItem('cepi.jwt')).toBe('tok');
    expect(w.find('.sesion-estado').text()).toContain('No se pudo validar tu sesión: HTTP 503');
    expect(w.findComponent(Login).exists()).toBe(false);
    await w.find('.sesion-acciones button').trigger('click');
    await flushPromises();
    expect(w.findComponent(Pantalla).exists()).toBe(true);
  });

  it('al volver la red reintenta sola', async () => {
    api.whoami.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { w } = await montar();
    window.dispatchEvent(new Event('online'));
    await flushPromises();
    expect(w.findComponent(Pantalla).exists()).toBe(true);
  });

  it('tras ingresar valida y entra; cerrar sesión vuelve al ingreso', async () => {
    const { w } = await montar({ token: null });
    localStorage.setItem('cepi.jwt', 'nuevo');
    w.findComponent(Login).vm.$emit('logged-in');
    await flushPromises();
    expect(w.findComponent(Pantalla).exists()).toBe(true);
    w.findComponent(Pantalla).vm.$emit('logout');
    await flushPromises();
    expect(api.logout).toHaveBeenCalled();
    expect(w.findComponent(Login).exists()).toBe(true);
  });

  it('una cuenta pendiente ve solo la pantalla de espera', async () => {
    api.whoami.mockResolvedValue({ user: { ...USUARIO, role: 'pendiente' } });
    const { w } = await montar();
    expect(w.findComponent(PendingApproval).exists()).toBe(true);
    expect(w.find('.topbar').exists()).toBe(false);
  });

  it('registro → verificación → ingreso', async () => {
    const { w } = await montar({ token: null });
    w.findComponent(Login).vm.$emit('go-register');
    await flushPromises();
    w.findComponent(Register).vm.$emit('registered', 'ana@cepi.ec');
    await flushPromises();
    expect(w.findComponent(VerifyEmail).props('email')).toBe('ana@cepi.ec');
    w.findComponent(VerifyEmail).vm.$emit('done');
    await flushPromises();
    expect(w.findComponent(Login).exists()).toBe(true);
  });
});

describe('App — organización', () => {
  it('con varias orgs hay selector; cambiar pide el cambio, bloquea la pantalla y recarga', async () => {
    api.switchOrg.mockResolvedValue({ token: 't2' });
    const { w } = await montar();
    const selector = w.find('.org-switch');
    expect(selector.findAll('option').map((o) => o.text())).toEqual(['🏥 CEPI Telemedicina', '🏥 CEPI Consultorio']);
    selector.element.value = 'o2';
    await selector.trigger('change');
    expect(w.find('.org-cambiando').text()).toBe('Cambiando de organización…');
    expect(w.find('.org-switch').element.disabled).toBe(true);
    await flushPromises();
    expect(api.switchOrg).toHaveBeenCalledWith('o2');
    expect(recargas).toBe(1);
  });

  it('si el cambio falla avisa y deja todo como estaba', async () => {
    api.switchOrg.mockRejectedValue(new Error('HTTP 403'));
    const { w } = await montar();
    w.find('.org-switch').element.value = 'o2';
    await w.find('.org-switch').trigger('change');
    await flushPromises();
    expect(recargas).toBe(0);
    expect(w.find('.org-cambiando').exists()).toBe(false);
    expect(w.find('.notif-toast').text()).toBe('No se pudo cambiar de organización.');
  });

  it('elegir la misma org no hace nada', async () => {
    const { w } = await montar();
    w.find('.org-switch').element.value = 'o1';
    await w.find('.org-switch').trigger('change');
    expect(api.switchOrg).not.toHaveBeenCalled();
  });

  it('con una sola org se muestra su nombre, sin selector', async () => {
    api.whoami.mockResolvedValue({ user: { ...USUARIO, orgs: [USUARIO.orgs[0]] } });
    const { w } = await montar();
    expect(w.find('.org-switch').exists()).toBe(false);
    expect(w.find('.org-chip').text()).toBe('🏥 CEPI Telemedicina');
  });
});

describe('App — menú', () => {
  it('Perfil, Casos y Galería navegan; la marca sigue a la ruta', async () => {
    const { w, router } = await montar();
    await boton(w, 'Casos').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/casos');
    expect(w.find('.brand').text()).toBe('Casos');
    await boton(w, 'Telemedicina').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/chat');
    await boton(w, 'Galería').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/galeria');
    await boton(w, 'Perfil').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/perfil');
    await boton(w, 'Volver').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/chat');
  });

  it('"Admin ↗" está siempre: gris con el motivo para quien no administra', async () => {
    const { w } = await montar();
    expect(boton(w, 'Admin').element.disabled).toBe(true);
    expect(boton(w, 'Admin').attributes('title')).toContain('Solo el superadministrador o el admin de una organización');
  });

  it('el admin de una org o el superadmin abren la consola del mismo dominio en otra pestaña', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    api.whoami.mockResolvedValue({ user: { ...USUARIO, orgs: [{ id: 'o1', name: 'X', role_in_org: 'admin' }] } });
    const { w } = await montar();
    await boton(w, 'Admin').trigger('click');
    expect(abrir).toHaveBeenCalledWith('https://console.cepi.ec', '_blank', 'noopener');
    api.whoami.mockResolvedValue({ user: { ...USUARIO, permissions: ['*:*:*:*'] } });
    window.location.hostname = 'localhost';
    const otra = await montar();
    await boton(otra.w, 'Admin').trigger('click');
    expect(abrir).toHaveBeenLastCalledWith('http://localhost:5175', '_blank', 'noopener');
  });

  it('con paciente abierto el chat toma el burger: el del topbar se retira', async () => {
    const { w } = await montar();
    expect(w.find('.top-burger').exists()).toBe(true);
    w.findComponent(Pantalla).vm.$emit('head', true);
    await flushPromises();
    expect(w.find('.top-burger').exists()).toBe(false);
  });

  it('el perfil guardado actualiza el nombre en pantalla', async () => {
    const { w } = await montar({ ruta: '/perfil' });
    w.findComponent(Pantalla).vm.$emit('saved', { email: 'nueva@cepi.ec' });
    await flushPromises();
    expect(w.find('.user-id').text()).toBe('nueva@cepi.ec · medico_primario');
  });
});

describe('App — avisos y notificaciones', () => {
  it('un aviso de la pantalla se muestra y se va solo a los 7 s', async () => {
    const { w } = await montar();
    w.findComponent(Pantalla).vm.$emit('aviso', 'Ese paciente no existe');
    await flushPromises();
    expect(w.find('.notif-toast').text()).toBe('Ese paciente no existe');
    await vi.advanceTimersByTimeAsync(7000);
    expect(w.find('.notif-toast').exists()).toBe(false);
  });

  it('una push en primer plano se muestra como aviso', async () => {
    const { w } = await montar();
    window.dispatchEvent(new CustomEvent('cepi:push-en-primer-plano', { detail: { title: 'Derivación', body: 'Ana Pérez' } }));
    await flushPromises();
    expect(w.find('.notif-toast').text()).toBe('Derivación — Ana Pérez');
  });

  it('abrir un aviso de la campana lleva al paciente', async () => {
    const { w, router } = await montar();
    w.findComponent(Notifications).vm.$emit('open', { id: 'p7' });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat/p7');
  });

  it('tocar una push abre lo que la originó: un episodio va al portal, un paciente a su chat', async () => {
    const { router } = await montar();
    api.obtenerEntidad.mockResolvedValue({ entity_id: '12000000-0000-0000-0000-000000000000' });
    window.dispatchEvent(new CustomEvent('cepi:open-entity', { detail: { entityId: 'e5' } }));
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/casos/caso/e5');
    api.obtenerEntidad.mockResolvedValue({ entity_id: '11000000-0000-0000-0000-000000000000' });
    window.dispatchEvent(new CustomEvent('cepi:open-entity', { detail: { entityId: 'p5' } }));
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat/p5');
  });

  it('una push de algo que no se puede resolver deja la app donde estaba', async () => {
    const { router } = await montar();
    api.obtenerEntidad.mockRejectedValue(new Error('HTTP 403'));
    window.dispatchEvent(new CustomEvent('cepi:open-entity', { detail: { entityId: 'x' } }));
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat');
  });

  it('"Activar" notificaciones pide el permiso y muestra el resultado', async () => {
    enableWebPush.mockResolvedValue('Notificaciones activadas ✔');
    const { w } = await montar();
    await boton(w, 'Activar').trigger('click');
    await flushPromises();
    expect(enableWebPush).toHaveBeenCalled();
    expect(w.find('.notif-toast').text()).toBe('Notificaciones activadas ✔');
  });
});
