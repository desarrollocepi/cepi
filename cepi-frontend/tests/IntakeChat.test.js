import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({
  chat: vi.fn(), saveSessionId: vi.fn(), uploadAttachment: vi.fn(), listGroups: vi.fn(),
  listGroupMembers: vi.fn(), listEntityDerivations: vi.fn(), listBotSessions: vi.fn(),
  getPatientThread: vi.fn(),
}));
vi.mock('../src/native/speech.js', () => ({ dictationSupported: false, createDictation: vi.fn() }));
import * as api from '../src/api.js';
import IntakeChat from '../src/components/IntakeChat.vue';

const P = 'pac-1';
const msg = (content, extra = {}) => ({ content, self: false, is_bot: false, episode_id: 'ep2', ts: '2026-10-08T12:00:00Z', ...extra });
const MARCADORES = [
  { id: 'g1', label: 'Motivo', category: 'Anamnesis', done: true },
  { id: 'g2', label: 'Antecedentes', category: 'Anamnesis', done: false },
  { id: 'g3', label: 'Examen', category: 'Examen físico', done: false },
];
const ACTIVACION = { session_id: 's1', bookmarks: MARCADORES, active_episode_id: 'ep2', quick_replies: [] };

/** Un hilo con dos consultas: una anterior (ep1) y la activa (ep2). */
const HILO = [
  msg('consulta vieja', { episode_id: 'ep1', self: true, ts: '2026-09-01T10:00:00Z' }),
  msg('Paciente activo: Ana', { is_bot: true, author_id: 'bot' }),
  msg('mi nota', { self: true }),
  msg('opino que es psoriasis', { author_id: 'u2', author_name: 'Dra. Colega' }),
  msg('y agrego esto', { author_id: 'u2', author_name: 'Dra. Colega' }),
];

function preparar({ hilo = HILO, activacion = ACTIVACION, sesiones = [] } = {}) {
  api.getPatientThread.mockResolvedValue({ messages: hilo });
  api.listBotSessions.mockResolvedValue({ sessions: sesiones });
  api.listEntityDerivations.mockResolvedValue({ derivados: [] });
  api.chat.mockImplementation(async (texto) => (texto.startsWith('activar paciente') ? activacion : { session_id: 's1' }));
}
function montar() {
  return mount(IntakeChat, {
    props: { user: { id: 'yo' } },
    global: { stubs: {
      teleport: true, BotForm: true, DoctoProSearch: true,
      MessageContent: { props: ['content'], template: '<div class="mc">{{ content }}</div>' },
    } },
  });
}
async function abrir(w = montar()) {
  w.vm.openPatient(P, 'Ana Pérez');
  await flushPromises();
  return w;
}
const turnos = (w) => w.findAll('.iturn .mc').map((t) => t.text());
const boton = (w, sel, texto) => w.findAll(sel).find((b) => b.text().includes(texto));
const nav = (w, titulo) => w.findAll('.enav').find((b) => b.attributes('title') === titulo);
async function escribirYEnviar(w, texto) {
  await w.find('.icomposer textarea').setValue(texto);
  await w.find('.icomposer').trigger('submit');
  await flushPromises();
}

beforeEach(() => { vi.useFakeTimers(); preparar(); });
afterEach(() => { vi.useRealTimers(); });

describe('IntakeChat — abrir un paciente', () => {
  it('mientras llega el hilo dice "Cargando…", sin "escribiendo…" ni el texto de bienvenida', async () => {
    let soltar;
    api.getPatientThread.mockReturnValue(new Promise((r) => { soltar = r; }));
    const w = montar();
    w.vm.openPatient(P, 'Ana Pérez');
    await flushPromises();
    expect(w.find('.ihead-name').text()).toContain('Ana Pérez');
    expect(w.find('.ep-label').text()).toBe('Cargando consultas…');
    expect(w.find('.iwelcome').text()).toBe('Cargando la información…');
    expect(w.find('.thinking').exists()).toBe(false);
    soltar({ messages: HILO });
    await flushPromises();
    expect(w.find('.iwelcome').exists()).toBe(false);
    expect(w.find('.ep-label').text()).toContain('Consulta 2/2');
  });

  it('pide el hilo guardado en paralelo con la activación, no después', async () => {
    api.listBotSessions.mockReturnValue(new Promise(() => {}));   // la activación no avanza
    const w = await abrir();
    expect(api.getPatientThread).toHaveBeenCalledWith(P);
    expect(api.chat).not.toHaveBeenCalled();
    expect(turnos(w)).toContain('mi nota');                        // lo guardado ya se ve
  });

  it('reanuda la sesión abierta propia de ese paciente; si no hay, activa sin sesión', async () => {
    preparar({ sesiones: [
      { id: 'cerrada', active_patient_id: P, estado: 'cerrada' },
      { id: 'otro', active_patient_id: 'pac-2', estado: 'abierta' },
      { id: 'mia', active_patient_id: P, estado: 'abierta' },
    ] });
    await abrir();
    expect(api.chat).toHaveBeenCalledWith('activar paciente ' + P, 'mia');
    api.chat.mockClear();
    preparar();
    await abrir();
    expect(api.chat).toHaveBeenCalledWith('activar paciente ' + P, null);
  });

  it('si la activación falla muestra el error y lo guardado sigue a la vista', async () => {
    api.chat.mockRejectedValue(new Error('HTTP 503'));
    const w = await abrir();
    expect(w.find('.ierror').text()).toBe('HTTP 503');
    expect(turnos(w)).toContain('mi nota');
  });

  it('si el hilo no carga lo dice, sin quedarse en "Cargando…"', async () => {
    api.getPatientThread.mockRejectedValue(new Error('HTTP 500'));
    const w = await abrir();
    expect(w.find('.ierror').text()).toContain('No se pudo cargar el hilo: HTTP 500');
    expect(w.find('.icarga-spin').exists()).toBe(false);
  });

  it('cambiar de paciente a mitad de carga descarta lo del anterior', async () => {
    let soltarViejo;
    api.getPatientThread.mockImplementation((id) => (id === P
      ? new Promise((r) => { soltarViejo = r; })
      : Promise.resolve({ messages: [msg('del segundo', { self: true })] })));
    const w = montar();
    w.vm.openPatient(P, 'Ana Pérez');
    await flushPromises();
    w.vm.openPatient('pac-2', 'Beto Ruiz');
    await flushPromises();
    soltarViejo({ messages: HILO });
    await flushPromises();
    expect(w.find('.ihead-name').text()).toContain('Beto Ruiz');
    expect(turnos(w)).toEqual(['del segundo']);
  });

  it('avisa arriba cuando hay paciente abierto', async () => {
    const w = await abrir();
    expect(w.emitted('head').at(-1)).toEqual([true]);
  });
});

describe('IntakeChat — consultas', () => {
  it('abre en la consulta activa y solo muestra sus mensajes', async () => {
    const w = await abrir();
    expect(turnos(w)).toEqual(['Paciente activo: Ana', 'mi nota', 'opino que es psoriasis', 'y agrego esto']);
    expect(nav(w, 'Consulta siguiente').element.disabled).toBe(true);
    expect(nav(w, 'Consulta anterior').element.disabled).toBe(false);
    expect(nav(w, 'Ya estás en la consulta actual').element.disabled).toBe(true);
  });

  it('en una consulta anterior: solo lectura, sin composer, y Secciones y Auto-form grises con motivo', async () => {
    const w = await abrir();
    await nav(w, 'Consulta anterior').trigger('click');
    expect(w.find('.ep-label').text()).toContain('Consulta 1/2');
    expect(turnos(w)).toEqual(['consulta vieja']);
    expect(w.find('.ireadonly').exists()).toBe(true);
    expect(w.find('.icomposer').exists()).toBe(false);
    const [secciones, auto] = w.findAll('.ihead-sections > button');
    expect(secciones.element.disabled).toBe(true);
    expect(secciones.attributes('title')).toBe('Secciones de la ficha: solo en la consulta actual');
    expect(auto.element.disabled).toBe(true);
    expect(auto.attributes('title')).toBe('Auto-form: solo en la consulta actual');

    await w.find('.icomposer-ro button').trigger('click');
    expect(w.find('.icomposer').exists()).toBe(true);
    expect(w.findAll('.ihead-sections > button')[0].element.disabled).toBe(false);
  });

  it('con una sola consulta lo dice y las flechas quedan deshabilitadas, no ocultas', async () => {
    preparar({ hilo: [msg('única', { self: true })] });
    const w = await abrir();
    expect(w.find('.ep-label').text()).toBe('Única consulta');
    expect(w.findAll('.enav')).toHaveLength(3);
    expect(w.findAll('.enav').every((b) => b.element.disabled)).toBe(true);
  });

  it('sin mensajes ni consulta: la barra sigue y dice "Sin consultas todavía"', async () => {
    preparar({ hilo: [], activacion: { session_id: 's1', bookmarks: [], active_episode_id: null } });
    const w = await abrir();
    expect(w.find('.iepisodes').exists()).toBe(true);
    expect(w.find('.ep-label').text()).toBe('Sin consultas todavía');
    expect(w.find('.iwelcome').text()).toContain('pega un texto');
    const secciones = w.findAll('.ihead-sections > button')[0];
    expect(secciones.element.disabled).toBe(true);
    expect(secciones.attributes('title')).toContain('disponibles al abrir la consulta');
  });

  it('una consulta recién abierta, todavía sin mensajes, también es una página', async () => {
    preparar({ activacion: { ...ACTIVACION, active_episode_id: 'ep3' } });
    const w = await abrir();
    expect(w.find('.ep-label').text()).toContain('Consulta 3/3');
    expect(turnos(w)).toEqual([]);
  });

  it('el aviso "Paciente activo:" repetido se muestra una sola vez (el último)', async () => {
    preparar({ hilo: [
      msg('Paciente activo: Ana (1)', { is_bot: true }),
      msg('hola', { self: true }),
      msg('Paciente activo: Ana (2)', { is_bot: true }),
    ] });
    const w = await abrir();
    expect(turnos(w)).toEqual(['hola', 'Paciente activo: Ana (2)']);
  });

  it('el autor va sobre lo ajeno, una vez por racha; lo propio no lleva', async () => {
    const w = await abrir();
    const etiquetas = w.findAll('.iturn').map((t) => t.find('.iturn-sender').exists() ? t.find('.iturn-sender').text() : '');
    expect(etiquetas).toEqual(['🤖 Asistente', '', 'Dra. Colega', '']);
    expect(w.findAll('.iturn').map((t) => t.classes()[1])).toEqual(['assistant', 'user', 'other', 'other']);
  });
});

describe('IntakeChat — enviar', () => {
  it('manda el texto por la sesión propia y relee el hilo', async () => {
    const w = await abrir();
    api.getPatientThread.mockResolvedValue({ messages: [...HILO, msg('nuevo', { self: true })] });
    await escribirYEnviar(w, '  nuevo  ');
    expect(api.chat).toHaveBeenLastCalledWith('nuevo', 's1', {});
    expect(turnos(w).at(-1)).toBe('nuevo');
    expect(w.find('.icomposer textarea').element.value).toBe('');
  });

  it('el eco aparece ya, con "escribiendo…", antes de que conteste el bot', async () => {
    const w = await abrir();
    let soltar;
    api.chat.mockReturnValue(new Promise((r) => { soltar = r; }));
    await w.find('.icomposer textarea').setValue('pregunta');
    await w.find('.icomposer').trigger('submit');
    await flushPromises();
    expect(turnos(w).at(-1)).toBe('pregunta');
    expect(w.find('.thinking').exists()).toBe(true);
    soltar({ session_id: 's1' });
    await flushPromises();
    expect(w.find('.thinking').exists()).toBe(false);
  });

  it('si el envío falla muestra el error y quita el eco', async () => {
    const w = await abrir();
    api.chat.mockRejectedValue(new Error('HTTP 500'));
    await escribirYEnviar(w, 'se pierde');
    expect(w.find('.ierror').text()).toBe('HTTP 500');
    expect(turnos(w)).not.toContain('se pierde');
  });

  it('vacío no envía, y Enviar está deshabilitado', async () => {
    const w = await abrir();
    api.chat.mockClear();
    expect(w.find('.icomposer button[type="submit"]').element.disabled).toBe(true);
    await escribirYEnviar(w, '   ');
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('Enter envía y Shift+Enter no', async () => {
    const w = await abrir();
    api.chat.mockClear();
    const ta = w.find('.icomposer textarea');
    await ta.setValue('línea');
    await ta.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(api.chat).not.toHaveBeenCalled();
    await ta.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(api.chat).toHaveBeenCalledWith('línea', 's1', {});
  });

  it('la foto adjunta viaja como marcador, con o sin texto', async () => {
    api.uploadAttachment.mockResolvedValue({ id: 'att-1', original_name: 'lesion.jpg' });
    const w = await abrir();
    const input = w.find('.iupload input');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'lesion.jpg')], configurable: true });
    await input.trigger('change');
    await flushPromises();
    expect(w.find('.iattached').text()).toContain('lesion.jpg');
    expect(w.find('.icomposer button[type="submit"]').element.disabled).toBe(false);
    await escribirYEnviar(w, 'mira');
    expect(api.chat).toHaveBeenLastCalledWith('mira\n[adjunto: lesion.jpg · att-1]', 's1', {});
    expect(w.find('.iattached').exists()).toBe(false);
  });

  it('si la subida falla lo dice y no queda adjunto', async () => {
    api.uploadAttachment.mockRejectedValue(new Error('HTTP 413'));
    const w = await abrir();
    const input = w.find('.iupload input');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.jpg')], configurable: true });
    await input.trigger('change');
    await flushPromises();
    expect(w.find('.ierror').text()).toBe('Subida falló: HTTP 413');
    expect(w.find('.iattached').exists()).toBe(false);
  });

  it('la sesión se crea recién al primer envío si abrir no la dejó', async () => {
    preparar({ activacion: { bookmarks: [], active_episode_id: 'ep2' } });   // sin session_id
    const w = await abrir();
    api.chat.mockClear();
    api.chat.mockImplementation(async (t) => (t.startsWith('activar') ? { session_id: 'nueva' } : { session_id: 'nueva' }));
    await escribirYEnviar(w, 'hola');
    expect(api.chat.mock.calls).toEqual([['activar paciente ' + P, null], ['hola', 'nueva', {}]]);
    expect(api.saveSessionId).toHaveBeenCalledWith('nueva');
  });
});

describe('IntakeChat — confirmación y respuestas rápidas', () => {
  it('lo pendiente se confirma con "sí" o se cancela con "no"', async () => {
    const w = await abrir();
    api.chat.mockResolvedValue({ session_id: 's1', pending_action: { summary: 'Guardar peso 70 kg' } });
    await escribirYEnviar(w, 'pesa 70');
    expect(w.find('.ipending-summary').text()).toBe('Guardar peso 70 kg');
    api.chat.mockResolvedValue({ session_id: 's1', pending_action: null });
    await w.find('.ipending .ok').trigger('click');
    await flushPromises();
    expect(api.chat).toHaveBeenLastCalledWith('sí', 's1', {});
    expect(w.find('.ipending').exists()).toBe(false);
  });

  it('una respuesta sin `pending_action` no borra lo pendiente', async () => {
    const w = await abrir();
    api.chat.mockResolvedValue({ session_id: 's1', pending_action: { summary: 'X' } });
    await escribirYEnviar(w, 'a');
    api.chat.mockResolvedValue({ session_id: 's1' });
    await escribirYEnviar(w, 'b');
    expect(w.find('.ipending').exists()).toBe(true);
  });

  it('una respuesta rápida manda su `send` y desaparece', async () => {
    preparar({ activacion: { ...ACTIVACION, quick_replies: [{ label: 'Sí, continuar', send: 'continuar' }] } });
    const w = await abrir();
    await w.find('.iquick-btn').trigger('click');
    await flushPromises();
    expect(api.chat).toHaveBeenLastCalledWith('continuar', 's1', {});
    expect(w.find('.iquick-btn').exists()).toBe(false);
  });
});

describe('IntakeChat — secciones y auto-form', () => {
  it('las secciones se agrupan por categoría y marcan lo hecho', async () => {
    const w = await abrir();
    await w.findAll('.ihead-sections > button')[0].trigger('click');
    expect(w.findAll('.sections-cat').map((c) => c.text())).toEqual(['Anamnesis', 'Examen físico']);
    expect(w.findAll('.sections-item').map((i) => i.text())).toEqual(['✓ Motivo', '○ Antecedentes', '○ Examen']);
  });

  it('elegir una sección pide su formulario y lo muestra aunque el auto-form esté apagado', async () => {
    const w = await abrir();
    api.chat.mockResolvedValue({ session_id: 's1', form: { id: 'ficha_grp_g2' } });
    await w.findAll('.ihead-sections > button')[0].trigger('click');
    await w.findAll('.sections-item')[1].trigger('click');
    await flushPromises();
    expect(api.chat).toHaveBeenLastCalledWith('', 's1', { formSubmission: { form_id: 'ficha_goto', data: { group: 'g2' } }, _explicit: true });
    expect(w.find('.iform').exists()).toBe(true);
    await w.find('.iform-close').trigger('click');
    expect(w.find('.iform').exists()).toBe(false);
  });

  it('con auto-form apagado, un formulario que el bot manda solo no se muestra', async () => {
    preparar({ activacion: { ...ACTIVACION, form: { id: 'ficha_grp_g2' } } });
    const w = await abrir();
    expect(w.find('.iform').exists()).toBe(false);
  });

  it('con auto-form encendido para ESE paciente, sí; y no se contagia a otro', async () => {
    localStorage.setItem('cepi.autoform.' + P, '1');
    preparar({ activacion: { ...ACTIVACION, form: { id: 'ficha_grp_g2' } } });
    const w = await abrir();
    expect(w.find('.iform').exists()).toBe(true);
    w.vm.openPatient('pac-2', 'Beto Ruiz');
    await flushPromises();
    expect(w.find('.iform').exists()).toBe(false);
    expect(w.find('.autoform-toggle').classes()).not.toContain('on');
  });

  it('encender el auto-form lo guarda y abre la primera sección pendiente', async () => {
    const w = await abrir();
    await w.find('.autoform-toggle').trigger('click');
    await flushPromises();
    expect(localStorage.getItem('cepi.autoform.' + P)).toBe('1');
    expect(api.chat).toHaveBeenLastCalledWith('', 's1', { formSubmission: { form_id: 'ficha_goto', data: { group: 'g2' } }, _explicit: true });
    api.chat.mockClear();
    await w.find('.autoform-toggle').trigger('click');
    expect(localStorage.getItem('cepi.autoform.' + P)).toBe('0');
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('"Nueva consulta" manda el comando', async () => {
    const w = await abrir();
    await boton(w, '.ihead-actions > button', 'Nueva consulta').trigger('click');
    await flushPromises();
    expect(api.chat).toHaveBeenLastCalledWith('nuevo episodio', 's1', {});
  });
});

describe('IntakeChat — derivar', () => {
  const GRUPOS = [
    { id: 1, slug: 'derma', name: 'Dermatología', kind: 'specialty', member_count: 2 },
    { id: 2, slug: 'turno', name: 'Turno', kind: 'roster', member_count: 5 },
    { id: 3, slug: 'vacio', name: 'Vacío', kind: 'circle', member_count: 0 },
    { id: 4, slug: 'todos', name: 'Todos', kind: 'all', member_count: 9 },
  ];
  beforeEach(() => {
    api.listGroups.mockResolvedValue({ data: GRUPOS });
    api.listGroupMembers.mockResolvedValue({ data: [
      { user_id: 'u2', name: 'Dra. Colega' },
      { user_id: 'u3', email: 'tres@cepi.ec' },
    ] });
  });
  async function abrirDerivar(w) {
    await boton(w, '.ihead-actions > button', 'Derivar').trigger('click');
    await flushPromises();
  }

  it('no ofrece el turno ni círculos sin miembros, y "toda la red" va primero', async () => {
    const w = await abrir();
    await abrirDerivar(w);
    expect(w.findAll('.dg-name').map((n) => n.text())).toEqual(['☐ 🌐 Todos', '☐ ⭕ Dermatología']);
  });

  it('el botón Derivar está gris con el motivo hasta marcar un destino', async () => {
    const w = await abrir();
    await abrirDerivar(w);
    expect(w.find('.derivar-go').element.disabled).toBe(true);
    expect(w.find('.derivar-go').attributes('title')).toContain('al menos un destino');
    await w.findAll('.dg-pick')[1].trigger('click');
    expect(w.find('.derivar-go').element.disabled).toBe(false);
    expect(w.find('.derivar-go').text()).toContain('1 destino(s)');
    await w.findAll('.dg-pick')[1].trigger('click');   // desmarcar
    expect(w.find('.derivar-go').element.disabled).toBe(true);
  });

  it('varios destinos y el motivo salen en un solo comando explícito, y el chat se cierra', async () => {
    const w = await abrir();
    await abrirDerivar(w);
    await w.findAll('.dg-pick')[1].trigger('click');
    await w.findAll('.dg-expand')[1].trigger('click');
    await flushPromises();
    await w.findAll('.dm-pick')[1].trigger('click');
    await w.find('.derivar-motivo').setValue(' segunda opinión ');
    await w.find('.derivar-go').trigger('click');
    await flushPromises();
    expect(api.chat).toHaveBeenLastCalledWith('derivar a derma, u3 segunda opinión', 's1', { explicit: true });
    expect(w.emitted('closed')).toHaveLength(1);
    expect(w.find('.ihead').exists()).toBe(false);
  });

  it('si derivar falla el chat no se cierra y el error queda a la vista', async () => {
    const w = await abrir();
    await abrirDerivar(w);
    await w.findAll('.dg-pick')[0].trigger('click');
    api.chat.mockRejectedValue(new Error('sin permiso'));
    await w.find('.derivar-go').trigger('click');
    await flushPromises();
    expect(w.emitted('closed')).toBeUndefined();
    expect(w.find('.ierror').text()).toBe('sin permiso');
  });

  it('a quien ya está derivado se lo marca y no se lo puede volver a elegir', async () => {
    api.listEntityDerivations.mockResolvedValue({ derivados: [{ user_id: 'u2', name: 'Dra. Colega' }] });
    const w = await abrir();
    expect(w.find('.iderivado').text()).toContain('Derivado a Dra. Colega');
    await w.find('.iderivado').trigger('click');
    await flushPromises();
    await w.findAll('.dg-expand')[1].trigger('click');
    await flushPromises();
    const [ya, libre] = w.findAll('.dm-pick');
    expect(ya.element.disabled).toBe(true);
    expect(ya.attributes('title')).toBe('El caso ya está derivado a esta persona');
    expect(libre.element.disabled).toBe(false);
    expect(libre.text()).toContain('tres@cepi.ec');
  });

  it('los miembros de un círculo se piden una vez', async () => {
    const w = await abrir();
    await abrirDerivar(w);
    const expandir = () => w.findAll('.dg-expand')[1];
    await expandir().trigger('click'); await flushPromises();
    await expandir().trigger('click');
    await expandir().trigger('click'); await flushPromises();
    expect(api.listGroupMembers).toHaveBeenCalledTimes(1);
  });

  it('si los destinos no cargan, lo dice', async () => {
    api.listGroups.mockRejectedValue(new Error('HTTP 500'));
    const w = await abrir();
    await abrirDerivar(w);
    expect(w.find('.derivar-error').text()).toBe('HTTP 500');
  });
});

describe('IntakeChat — refresco del hilo', () => {
  it('lo que escribe otro aparece solo, a los 5 s', async () => {
    const w = await abrir();
    api.getPatientThread.mockResolvedValue({ messages: [...HILO, msg('desde WhatsApp', { author_id: 'u2', author_name: 'Dra. Colega' })] });
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(turnos(w).at(-1)).toBe('desde WhatsApp');
  });

  it('no refresca con un envío en curso ni sin paciente', async () => {
    const w = montar();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getPatientThread).not.toHaveBeenCalled();
    await abrir(w);
    api.chat.mockReturnValue(new Promise(() => {}));
    await w.find('.icomposer textarea').setValue('x');
    await w.find('.icomposer').trigger('submit');
    await flushPromises();
    api.getPatientThread.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getPatientThread).not.toHaveBeenCalled();
  });

  it('un fallo del refresco no muestra error', async () => {
    const w = await abrir();
    api.getPatientThread.mockRejectedValue(new Error('sin red'));
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(w.find('.ierror').exists()).toBe(false);
    expect(turnos(w)).toContain('mi nota');
  });

  it('al desmontarse deja de consultar', async () => {
    const w = await abrir();
    w.unmount();
    api.getPatientThread.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.getPatientThread).not.toHaveBeenCalled();
  });
});
