import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { h, defineComponent } from 'vue';

vi.mock('../src/api.js', () => ({ listarCasosDePaciente: vi.fn(), obtenerEntidad: vi.fn() }));
import * as api from '../src/api.js';
import ChatShell from '../src/components/ChatShell.vue';

const DEF_PACIENTE = '11000000-0000-0000-0000-000000000000';
const paciente = (id, nombre) => ({ id, data: { nombre, apellidos: 'Pérez' } });

// Los hijos se reemplazan por dobles que registran lo que el shell les pide.
const abiertos = [];
let generales = 0;
const IntakeChat = defineComponent({
  name: 'IntakeChat',
  emits: ['closed', 'back', 'head'],
  setup(_, { expose }) {
    expose({ openPatient: (id, nombre) => abiertos.push([id, nombre]), newGeneral: () => { generales++; } });
    return () => h('div', { class: 'chat-doble' });
  },
});
const ChatList = defineComponent({ name: 'ChatList', props: ['activeId', 'user', 'generalActive'], emits: ['select', 'general'], render: () => h('div', { class: 'lista-doble' }) });
const FichaCompleta = defineComponent({ name: 'FichaCompleta', props: ['patientId', 'episodeId', 'visitas', 'cargandoVisitas'], emits: ['navegar'], render: () => h('div', { class: 'ficha-doble' }) });
const RejillaImagenes = defineComponent({ name: 'RejillaImagenes', props: ['patientId', 'mostrarPaciente', 'vacio'], render: () => h('div', { class: 'rejilla-doble' }) });

let movil = false;
async function montar(ruta = '/chat') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/chat', name: 'chat', component: { render: () => null } },
      { path: '/chat/:patientId/:seccion(ficha|imagenes)?', name: 'chat-paciente', component: { render: () => null } },
      { path: '/perfil', name: 'perfil', component: { render: () => null } },
    ],
  });
  await router.push(ruta);
  const w = mount(ChatShell, {
    props: { user: { id: 'yo' } },
    global: { plugins: [router], stubs: { ChatList, IntakeChat, FichaCompleta, RejillaImagenes } },
  });
  await flushPromises();
  return { w, router };
}
const lista = (w) => w.findComponent(ChatList);
const pestana = (w, texto) => w.findAll('.shell-secciones button').find((b) => b.text().includes(texto));

beforeEach(() => {
  abiertos.length = 0; generales = 0; movil = false;
  window.matchMedia = () => ({ matches: movil, addEventListener() {}, removeEventListener() {} });
  api.listarCasosDePaciente.mockResolvedValue({ data: [{ id: 'ep2', fecha: '2026-10-01' }, { id: 'ep1', fecha: '2026-09-01' }] });
  api.obtenerEntidad.mockImplementation(async (id) => ({ id, entity_id: DEF_PACIENTE, data: { nombre: 'Remoto', apellidos: 'López' } }));
});

describe('ChatShell — el paciente abierto lo manda la URL', () => {
  it('elegir un paciente navega a su URL y abre su chat', async () => {
    const { w, router } = await montar();
    expect(w.find('.shell-secciones').exists()).toBe(false);
    lista(w).vm.$emit('select', paciente('p1', 'Ana'));
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat/p1');
    expect(abiertos).toEqual([['p1', 'Ana Pérez']]);
    expect(lista(w).props('activeId')).toBe('p1');
    expect(api.obtenerEntidad).not.toHaveBeenCalled();   // viene de la lista: no se valida de nuevo
  });

  it('volver a tocar el ya abierto recarga su hilo sin sumar historial', async () => {
    const { w, router } = await montar();
    lista(w).vm.$emit('select', paciente('p1', 'Ana'));
    await flushPromises();
    const antes = router.currentRoute.value.fullPath;
    lista(w).vm.$emit('select', paciente('p1', 'Ana'));
    await flushPromises();
    expect(abiertos).toHaveLength(2);
    expect(router.currentRoute.value.fullPath).toBe(antes);
  });

  it('un enlace directo valida el id y resuelve el nombre antes de abrir', async () => {
    const { w } = await montar('/chat/p9');
    expect(api.obtenerEntidad).toHaveBeenCalledWith('p9');
    expect(abiertos).toEqual([['p9', 'Remoto López']]);
    expect(pestana(w, 'Chat').attributes('aria-selected')).toBe('true');
  });

  it('un enlace con sección cae directo en ella', async () => {
    const { w } = await montar('/chat/p9/imagenes');
    expect(pestana(w, 'Imágenes').attributes('aria-selected')).toBe('true');
    expect(w.findComponent(RejillaImagenes).props()).toMatchObject({ patientId: 'p9', mostrarPaciente: false });
  });

  it('un paciente ajeno o inexistente no se abre: avisa y vuelve a la lista', async () => {
    api.obtenerEntidad.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }));
    const { w, router } = await montar('/chat/p9');
    expect(abiertos).toEqual([]);
    expect(w.emitted('aviso')[0][0]).toContain('no existe o no pertenece');
    expect(router.currentRoute.value.fullPath).toBe('/chat');
  });

  it('un id que es de otra cosa (un episodio) tampoco se abre', async () => {
    api.obtenerEntidad.mockResolvedValue({ id: 'e1', entity_id: '12000000-0000-0000-0000-000000000000', data: {} });
    const { w } = await montar('/chat/e1');
    expect(abiertos).toEqual([]);
    expect(w.emitted('aviso')[0][0]).toContain('no existe o no pertenece');
  });

  it('sin red no afirma que el paciente no exista', async () => {
    api.obtenerEntidad.mockRejectedValue(new Error('Failed to fetch'));
    const { w } = await montar('/chat/p9');
    expect(w.emitted('aviso')[0][0]).toBe('No se pudo abrir el paciente. Reintenta desde la lista.');
  });

  it('los enlaces viejos `?paciente=<id>` se traducen a la URL nueva', async () => {
    const { router } = await montar('/chat?paciente=p9');
    expect(router.currentRoute.value.fullPath).toBe('/chat/p9');
    expect(abiertos).toEqual([['p9', 'Remoto López']]);
  });

  it('el atrás del navegador vuelve al paciente anterior y luego a la lista', async () => {
    const { w, router } = await montar();
    lista(w).vm.$emit('select', paciente('p1', 'Ana'));
    await flushPromises();
    lista(w).vm.$emit('select', paciente('p2', 'Beto'));
    await flushPromises();
    router.back(); await flushPromises();
    expect(lista(w).props('activeId')).toBe('p1');
    router.back(); await flushPromises();
    expect(lista(w).props('activeId')).toBeNull();
    expect(generales).toBe(1);   // el chat suelta al paciente
  });

  it('al salir a otra vista no toca al paciente abierto', async () => {
    const { w, router } = await montar('/chat/p9');
    await router.push('/perfil');
    await flushPromises();
    expect(lista(w).props('activeId')).toBe('p9');
  });
});

describe('ChatShell — secciones del paciente', () => {
  it('cambiar de sección reemplaza la URL: el atrás no recorre las pestañas', async () => {
    const { w, router } = await montar();
    lista(w).vm.$emit('select', paciente('p1', 'Ana'));
    await flushPromises();
    await pestana(w, 'Ficha').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat/p1/ficha');
    await pestana(w, 'Imágenes').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat/p1/imagenes');
    await pestana(w, 'Chat').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat/p1');
    router.back(); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat');
  });

  it('el chat queda montado al cambiar de sección: no se pierde lo escrito', async () => {
    const { w } = await montar('/chat/p9/ficha');
    expect(w.find('.chat-doble').exists()).toBe(true);
    expect(w.find('.chat-doble').element.style.display).toBe('none');
  });

  it('la Ficha abre en la consulta más reciente y recibe las visitas', async () => {
    const { w } = await montar('/chat/p9/ficha');
    expect(api.listarCasosDePaciente).toHaveBeenCalledWith('p9');
    const ficha = w.findComponent(FichaCompleta);
    expect(ficha.props('episodeId')).toBe('ep2');
    expect(ficha.props('visitas')).toHaveLength(2);
    expect(ficha.props('cargandoVisitas')).toBe(false);
  });

  it('«Anterior» y «Siguiente» de la ficha cambian de consulta', async () => {
    const { w } = await montar('/chat/p9/ficha');
    const ficha = w.findComponent(FichaCompleta);
    ficha.vm.$emit('navegar', 'ep1');
    await flushPromises();
    expect(ficha.props('episodeId')).toBe('ep1');
    ficha.vm.$emit('navegar', 'ep2');
    await flushPromises();
    expect(ficha.props('episodeId')).toBe('ep2');
  });

  it('la consulta elegida no se arrastra a otro paciente', async () => {
    const { w, router } = await montar('/chat/p9/ficha');
    w.findComponent(FichaCompleta).vm.$emit('navegar', 'ep1');
    api.listarCasosDePaciente.mockResolvedValue({ data: [{ id: 'x2' }, { id: 'x1' }] });
    await router.push('/chat/p8/ficha');
    await flushPromises();
    expect(w.findComponent(FichaCompleta).props('episodeId')).toBe('x2');
  });

  it('las visitas se piden recién al entrar a la Ficha, y una vez por paciente', async () => {
    const { w } = await montar('/chat/p9');
    expect(api.listarCasosDePaciente).not.toHaveBeenCalled();
    await pestana(w, 'Ficha').trigger('click'); await flushPromises();
    await pestana(w, 'Chat').trigger('click'); await flushPromises();
    await pestana(w, 'Ficha').trigger('click'); await flushPromises();
    expect(api.listarCasosDePaciente).toHaveBeenCalledTimes(1);
  });

  it('si las visitas fallan, la ficha se queda sin ellas y se reintenta al volver', async () => {
    api.listarCasosDePaciente.mockRejectedValueOnce(new Error('HTTP 500'));
    const { w } = await montar('/chat/p9/ficha');
    expect(w.findComponent(FichaCompleta).props('visitas')).toEqual([]);
    await pestana(w, 'Chat').trigger('click'); await flushPromises();
    await pestana(w, 'Ficha').trigger('click'); await flushPromises();
    expect(w.findComponent(FichaCompleta).props('visitas')).toHaveLength(2);
  });
});

describe('ChatShell — cerrar y móvil', () => {
  it('cuando el chat se cierra (tras derivar) se suelta al paciente y la URL', async () => {
    const { w, router } = await montar('/chat/p9');
    w.findComponent(IntakeChat).vm.$emit('closed');
    await flushPromises();
    expect(lista(w).props('activeId')).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe('/chat');
    expect(w.find('.shell-secciones').exists()).toBe(false);
  });

  it('el burger del chat solo cuenta con paciente abierto y en la vista de chat', async () => {
    movil = true;
    const { w } = await montar();
    w.findComponent(IntakeChat).vm.$emit('head', true);
    await flushPromises();
    expect(w.emitted('head').at(-1)).toEqual([false]);   // en móvil se está viendo la lista
    lista(w).vm.$emit('select', paciente('p1', 'Ana'));
    await flushPromises();
    expect(w.classes()).toContain('shell--chat');
    expect(w.emitted('head').at(-1)).toEqual([true]);
  });

  it('en móvil «volver» sale de la URL del paciente y muestra la lista', async () => {
    movil = true;
    const { w, router } = await montar('/chat/p9');
    expect(w.classes()).toContain('shell--chat');
    w.findComponent(IntakeChat).vm.$emit('back');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/chat');
    expect(w.classes()).toContain('shell--list');
  });
});
