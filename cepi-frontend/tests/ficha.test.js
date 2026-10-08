// La ficha: el formulario de un grupo (BotForm), sus campos especiales y la ficha completa.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({ fichaCompleta: vi.fn(), guardarGrupoFicha: vi.fn(), uploadAttachment: vi.fn() }));
import * as api from '../src/api.js';
import BotForm from '../src/components/BotForm.vue';
import BodyMapField from '../src/components/BodyMapField.vue';
import IcdSearchField from '../src/components/IcdSearchField.vue';
import EntitySearchField from '../src/components/EntitySearchField.vue';
import ImageUploadField from '../src/components/ImageUploadField.vue';
import FichaCompleta from '../src/components/FichaCompleta.vue';

const json = (body) => ({ ok: true, status: 200, json: async () => body });

describe('BotForm — formulario estructurado (grupo de la ficha)', () => {
  const FORM = {
    id: 'ficha_grp_g1', title: 'Motivo', submit_mode: 'structured', submit_label: 'Guardar',
    fields: [
      { type: 'heading', label: 'Datos' },
      { key: 'motivo', label: 'Motivo', type: 'textarea', required: true },
      { key: 'desde', label: 'Desde', type: 'date' },
      { key: 'prurito', label: 'Prurito', type: 'checkbox' },
      { key: 'intensidad', label: 'Intensidad', type: 'radio', options: ['leve', { label: 'Grave', value: 'grave' }] },
      { key: 'obs', label: 'Observaciones' },
    ],
    values: { motivo: 'mancha', prurito: true },
    actions: [{ label: 'Omitir', send: 'omitir g1' }],
  };
  const montar = (form = FORM, props = {}) => mount(BotForm, { props: { form, ...props } });

  it('pinta cada tipo de campo y precarga los valores guardados', () => {
    const w = montar();
    expect(w.find('.bot-form-title').text()).toBe('Motivo');
    expect(w.find('.bf-heading').text()).toBe('Datos');
    expect(w.find('textarea').element.value).toBe('mancha');
    expect(w.find('input[type="date"]').exists()).toBe(true);
    expect(w.find('input[type="checkbox"]').element.checked).toBe(true);
    expect(w.findAll('.bf-radio').map((r) => r.text())).toEqual(['leve', 'Grave']);
    expect(w.findAll('.bf-req')).toHaveLength(1);
  });

  it('guarda el mapa de campos sin los vacíos, conservando los booleanos', async () => {
    const w = montar();
    await w.findAll('input[type="radio"]')[1].setValue(true);
    await w.find('form').trigger('submit');
    expect(w.emitted('submit')[0][0]).toEqual({ form_id: 'ficha_grp_g1', data: { motivo: 'mancha', prurito: true, intensidad: 'grave' } });
  });

  it('un casillero desmarcado viaja como false, no se pierde', async () => {
    const w = montar();
    await w.find('input[type="checkbox"]').setValue(false);
    await w.find('form').trigger('submit');
    expect(w.emitted('submit')[0][0].data.prurito).toBe(false);
  });

  it('siempre se puede guardar: en la ficha todo es opcional', () => {
    const w = montar({ ...FORM, values: {} });
    expect(w.find('.bf-submit').element.disabled).toBe(false);
  });

  it('las acciones secundarias mandan su comando', async () => {
    const w = montar();
    await w.find('.bf-action').trigger('click');
    expect(w.emitted('send')[0]).toEqual(['omitir g1']);
  });

  it('ocupado: nada se puede tocar ni enviar', async () => {
    const w = montar(FORM, { busy: true });
    expect(w.find('textarea').element.disabled).toBe(true);
    expect(w.find('.bf-submit').element.disabled).toBe(true);
    expect(w.find('.bf-action').element.disabled).toBe(true);
    await w.find('form').trigger('submit');
    expect(w.emitted('submit')).toBeUndefined();
  });

  it('una sola pregunta cerrada se envía al elegir, sin botón Guardar', async () => {
    const w = montar({ id: 'ficha_grp_g2', title: '¿Fuma?', submit_mode: 'structured', fields: [{ key: 'fuma', label: '¿Fuma?', type: 'radio', options: ['sí', 'no'] }] });
    expect(w.find('.bf-submit').exists()).toBe(false);
    await w.findAll('input[type="radio"]')[0].setValue(true);
    expect(w.emitted('submit')[0][0]).toEqual({ form_id: 'ficha_grp_g2', data: { fuma: 'sí' } });
  });
});

describe('BotForm — formulario de mensaje', () => {
  const FORM = {
    id: 'nuevo', title: 'Nuevo paciente', submit_send: 'crear paciente {nombre} cédula {cedula}',
    fields: [{ key: 'nombre', label: 'Nombre', required: true }, { key: 'cedula', label: 'Cédula' }],
  };

  it('no deja enviar sin los obligatorios', async () => {
    const w = mount(BotForm, { props: { form: FORM } });
    expect(w.find('.bf-submit').element.disabled).toBe(true);
    await w.findAll('input')[1].setValue('0101');
    expect(w.find('.bf-submit').element.disabled).toBe(true);
    await w.findAll('input')[0].setValue('  Ana ');
    expect(w.find('.bf-submit').element.disabled).toBe(false);
  });

  it('arma el mensaje con los valores en la plantilla', async () => {
    const w = mount(BotForm, { props: { form: FORM } });
    await w.findAll('input')[0].setValue('  Ana ');
    await w.findAll('input')[1].setValue('0101');
    await w.find('form').trigger('submit');
    expect(w.emitted('send')[0]).toEqual(['crear paciente Ana cédula 0101']);
    expect(w.emitted('submit')).toBeUndefined();
  });

  it('sin obligatorios alcanza con llenar cualquiera', async () => {
    const w = mount(BotForm, { props: { form: { id: 'b', title: 'Buscar', submit_send: 'buscar {q}', fields: [{ key: 'q', label: 'Texto' }] } } });
    expect(w.find('.bf-submit').element.disabled).toBe(true);
    await w.find('input').setValue('psoriasis');
    expect(w.find('.bf-submit').element.disabled).toBe(false);
  });
});

describe('BodyMapField', () => {
  it('ofrece las 38 regiones, cada una con su nombre', () => {
    const w = mount(BodyMapField);
    const regiones = w.findAll('.region');
    expect(regiones).toHaveLength(38);
    expect(regiones.every((r) => r.attributes('aria-label'))).toBe(true);
    expect(w.find('.body-map-summary').text()).toContain('zonas con lesiones');
  });

  it('marca lo que viene en el valor y lo resume', () => {
    const w = mount(BodyMapField, { props: { modelValue: 'torax, mano_izq' } });
    expect(w.findAll('.region.sel')).toHaveLength(2);
    expect(w.find('.body-map-summary').text()).toBe('2 región(es): Tórax, Mano izquierda');
  });

  it('tocar agrega o quita, y el valor sale siempre en el orden del mapa', async () => {
    const w = mount(BodyMapField, { props: { modelValue: 'torax' } });
    await w.find('[aria-label="Cabeza (frontal)"]').trigger('click');
    expect(w.emitted('update:modelValue')[0]).toEqual(['cabeza_ant,torax']);
    await w.find('[aria-label="Tórax"]').trigger('click');
    expect(w.emitted('update:modelValue')[1]).toEqual(['']);
  });

  it('ocupado no cambia nada', async () => {
    const w = mount(BodyMapField, { props: { busy: true } });
    expect(w.find('.region').element.disabled).toBe(true);
  });
});

describe('IcdSearchField', () => {
  let fetchMock;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => json({ results: [{ code: 'L40', title: 'Psoriasis' }, { code: '', title: 'Sin código' }] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const montar = () => mount(IcdSearchField, { props: { field: {}, modelValue: '' } });
  async function escribir(w, texto) {
    const input = w.find('input');
    input.element.value = texto;
    await input.trigger('input');
  }

  it('lo escrito es el valor del campo, aunque no se elija nada de la lista', async () => {
    const w = montar();
    await escribir(w, 'ps');
    expect(w.emitted('update:modelValue')[0]).toEqual(['ps']);
  });

  it('busca recién con 3 caracteres y tras una pausa, con el token', async () => {
    localStorage.setItem('cepi.jwt', 'tok');
    const w = montar();
    await escribir(w, 'ps');
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).not.toHaveBeenCalled();
    await escribir(w, 'pso');
    await escribir(w, 'psor');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/icd10/search?q=psor');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(w.findAll('.icdf-opt').map((o) => o.text())).toEqual(['L40 Psoriasis', '— Sin código']);
  });

  it('elegir deja "código — título" y cierra la lista', async () => {
    const w = montar();
    await escribir(w, 'psor');
    await vi.advanceTimersByTimeAsync(300); await flushPromises();
    await w.findAll('.icdf-opt')[0].trigger('click');
    expect(w.emitted('update:modelValue').at(-1)).toEqual(['L40 — Psoriasis']);
    expect(w.find('.icdf-drop').exists()).toBe(false);
  });

  it('sin resultados o con error dice "Sin coincidencias"', async () => {
    fetchMock.mockRejectedValue(new Error('red'));
    const w = montar();
    await escribir(w, 'zzzz');
    expect(w.find('.icdf-msg').text()).toBe('Buscando en CIE-10…');
    await vi.advanceTimersByTimeAsync(300); await flushPromises();
    expect(w.find('.icdf-msg').text()).toBe('Sin coincidencias.');
  });
});

describe('EntitySearchField', () => {
  let fetchMock;
  const fila = (n) => ({ id: 'id' + n, data: { nombre: 'Nombre' + n, apellidos: 'Ap' + n, cedula: '0' + n } });
  const CAMPO = { entity_id: 'def-1', min_chars: 2, page_size: 2, result_label: ['nombre', 'apellidos'], result_sub: 'cedula', on_select_send: 'activar paciente {id} ({cedula})' };
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => json({ ok: true, data: [fila(1), fila(2)] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  async function buscar(w, texto) {
    await w.find('input').setValue(texto);
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
  }

  it('pide el mínimo de caracteres antes de buscar', async () => {
    const w = mount(EntitySearchField, { props: { field: CAMPO } });
    await buscar(w, 'a');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.find('.es-hint').text()).toContain('al menos 2 caracteres');
  });

  it('busca en la entidad indicada y arma etiqueta y subtítulo', async () => {
    const w = mount(EntitySearchField, { props: { field: CAMPO } });
    await buscar(w, 'nom');
    const url = new URL(fetchMock.mock.calls[0][0], 'http://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'business', entity_id: 'def-1', q: 'nom', limit: '2', offset: '0' });
    expect(w.findAll('.es-opt-label').map((o) => o.text())).toEqual(['Nombre1 Ap1', 'Nombre2 Ap2']);
    expect(w.find('.es-opt-sub').text()).toBe('01');
  });

  it('elegir manda el comando con los datos del registro', async () => {
    const w = mount(EntitySearchField, { props: { field: CAMPO } });
    await buscar(w, 'nom');
    await w.findAll('.es-option')[1].trigger('click');
    expect(w.emitted('select')[0]).toEqual(['activar paciente id2 (02)']);
    expect(w.find('.es-dropdown').exists()).toBe(false);
    expect(w.find('input').element.value).toBe('Nombre2 Ap2');
  });

  it('una página incompleta marca el fin de los resultados', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, data: [fila(1)] }));
    const w = mount(EntitySearchField, { props: { field: CAMPO } });
    await buscar(w, 'nom');
    expect(w.find('.es-end').exists()).toBe(true);
  });

  it('sin coincidencias, o si la búsqueda falla, lo dice', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, data: [] }));
    const w = mount(EntitySearchField, { props: { field: CAMPO } });
    await buscar(w, 'zzz');
    expect(w.find('.es-hint').text()).toBe('Sin coincidencias.');
    fetchMock.mockRejectedValue(new Error('red'));
    await buscar(w, 'zzzz');
    expect(w.find('.es-hint').text()).toBe('Sin coincidencias.');
  });
});

describe('ImageUploadField', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation((f) => 'blob:' + f.name);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  async function elegir(w, ...nombres) {
    const input = w.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: nombres.map((n) => new File(['x'], n)), configurable: true });
    await input.trigger('change');
    await flushPromises();
  }
  const ultimo = (w) => w.emitted('update:modelValue').at(-1)[0];

  it('sube la foto y el valor es su id', async () => {
    api.uploadAttachment.mockResolvedValue({ id: 'att-1' });
    const w = mount(ImageUploadField);
    expect(w.find('.img-upload-hint').text()).toBe('Subí la imagen.');
    await elegir(w, 'a.jpg');
    expect(ultimo(w)).toBe('att-1');
    expect(w.find('.img-upload-item').classes()).toContain('done');
    expect(w.find('.img-upload-status').text()).toBe('listo');
  });

  it('con varias, el valor es la lista de ids; una que falla no entra', async () => {
    api.uploadAttachment.mockResolvedValueOnce({ id: 'att-1' }).mockRejectedValueOnce(new Error('413')).mockResolvedValueOnce({ id: 'att-3' });
    const w = mount(ImageUploadField, { props: { multiple: true } });
    await elegir(w, 'a.jpg', 'b.jpg', 'c.jpg');
    expect(ultimo(w)).toBe('att-1,att-3');
    expect(w.findAll('.img-upload-item').map((i) => i.find('.img-upload-status').text())).toEqual(['listo', 'error', 'listo']);
  });

  it('campo de una sola imagen: elegir otra reemplaza la anterior', async () => {
    api.uploadAttachment.mockResolvedValueOnce({ id: 'att-1' }).mockResolvedValueOnce({ id: 'att-2' });
    const w = mount(ImageUploadField);
    await elegir(w, 'a.jpg');
    await elegir(w, 'b.jpg');
    expect(w.findAll('.img-upload-item')).toHaveLength(1);
    expect(ultimo(w)).toBe('att-2');
  });

  it('quitar una la saca del valor y libera su vista previa', async () => {
    api.uploadAttachment.mockResolvedValueOnce({ id: 'att-1' }).mockResolvedValueOnce({ id: 'att-2' });
    const w = mount(ImageUploadField, { props: { multiple: true } });
    await elegir(w, 'a.jpg', 'b.jpg');
    await w.find('.img-upload-rm').trigger('click');
    expect(ultimo(w)).toBe('att-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a.jpg');
  });
});

describe('FichaCompleta', () => {
  const grupo = (id, extra = {}) => ({
    id, label: 'Grupo ' + id, category: '§3 Enfermedad actual', done: true, target: 'episode',
    form: { id: 'ficha_grp_' + id, title: 'Grupo ' + id, submit_mode: 'structured', fields: [{ key: 'campo_' + id, label: 'Campo ' + id }], values: { ['campo_' + id]: 'valor ' + id }, actions: [{ label: 'Omitir', send: 'omitir' }] },
    ...extra,
  });
  const FICHA = {
    completos: 2, total: 4,
    grupos: [
      grupo('a', { category: '§1 Paciente', target: 'patient' }),
      grupo('b'),
      grupo('c', { done: false, form: { id: 'ficha_grp_c', fields: [{ key: 'campo_c', label: 'Campo c' }], values: {} } }),
      grupo('g_4_7', { category: '§4 Imágenes', done: false }),
    ],
  };
  const VISITAS = [
    { id: 'ep2', fecha: '2026-10-01T00:00:00Z', campo_b: 'valor b', campo_a: 'x' },
    { id: 'ep1', fecha: '2026-09-01T00:00:00Z', campo_b: 'valor viejo', campo_a: 'otro', campo_g_4_7: 'valor g_4_7' },
  ];
  async function montar(props = {}) {
    const w = mount(FichaCompleta, { props: { episodeId: 'ep2', patientId: 'p1', visitas: VISITAS, ...props } });
    await flushPromises();
    return w;
  }
  const navegar = (w, texto) => w.findAll('.ficha-nav-btn').find((b) => b.text().includes(texto));
  beforeEach(() => { api.fichaCompleta.mockResolvedValue(FICHA); });

  it('pide la ficha del episodio y muestra el avance', async () => {
    const w = await montar();
    expect(api.fichaCompleta).toHaveBeenCalledWith({ episodeId: 'ep2', patientId: 'p1' });
    expect(w.find('.ficha-pct').text()).toBe('2 de 4 grupos con dato');
    expect(w.find('.ficha-barra-fill').attributes('style')).toContain('50%');
    expect(w.findAll('.ficha-cat-titulo').map((t) => t.text().replace(/\s+/g, ' '))).toEqual(['§1 Paciente 1/1', '§3 Enfermedad actual 1/2', '§4 Imágenes 0/1']);
  });

  it('un grupo sin dato dice "Sin dato" y ofrece Completar; con dato, Editar', async () => {
    const w = await montar();
    const grupos = w.findAll('.ficha-grupo');
    expect(grupos[1].find('.ficha-editar').text()).toBe('Editar');
    expect(grupos[2].find('.ficha-vacio').text()).toBe('Sin dato');
    expect(grupos[2].find('.ficha-editar').text()).toBe('Completar');
    expect(grupos[2].classes()).toContain('ficha-grupo--vacio');
  });

  it('los grupos de imágenes no se editan desde acá', async () => {
    const w = await montar();
    expect(w.findAll('.ficha-grupo')[3].find('.ficha-editar').exists()).toBe(false);
  });

  it('"Solo lo que falta" deja los grupos sin dato y saca los bloques completos', async () => {
    const w = await montar();
    await w.find('.ficha-toggle input').setValue(true);
    expect(w.findAll('.ficha-grupo-titulo').map((t) => t.text())).toEqual(expect.arrayContaining([expect.stringContaining('Grupo c')]));
    expect(w.findAll('.ficha-grupo')).toHaveLength(2);
    expect(w.text()).not.toContain('§1 Paciente');
  });

  it('marca en rojo lo que cambió respecto de la visita anterior, y lo cuenta arriba', async () => {
    const w = await montar();
    expect(w.find('.ficha-nav-dif').text()).toBe('1 campo cambió desde el del 2026-09-01');
    const cambiados = w.findAll('.dt-cambiado');
    expect(cambiados).toHaveLength(1);
    expect(cambiados[0].text()).toBe('Campo b');
    expect(cambiados[0].attributes('title')).toBe('Valor anterior: valor viejo');
  });

  it('los datos del paciente no se comparan entre visitas: no salen en rojo', async () => {
    const w = await montar();
    const dts = w.findAll('.ficha-grupo')[0].findAll('dt');
    expect(dts[0].classes()).not.toContain('dt-cambiado');
  });

  it('navegar: en la más reciente "Siguiente" está gris con su motivo y "Anterior" emite', async () => {
    const w = await montar();
    expect(w.find('.ficha-nav-pos strong').text()).toBe('Episodio 2 de 2');
    expect(navegar(w, 'Siguiente').element.disabled).toBe(true);
    expect(navegar(w, 'Siguiente').attributes('title')).toBe('Es el episodio más reciente');
    await navegar(w, 'Anterior').trigger('click');
    expect(w.emitted('navegar')[0]).toEqual(['ep1']);
  });

  it('en la primera visita lo dice, y "Anterior" queda gris', async () => {
    const w = await montar({ episodeId: 'ep1' });
    expect(w.find('.ficha-nav-pos').text()).toContain('es el primer episodio del paciente');
    expect(navegar(w, 'Anterior').element.disabled).toBe(true);
    expect(navegar(w, 'Anterior').attributes('title')).toBe('Es el primer episodio');
    await navegar(w, 'Siguiente').trigger('click');
    expect(w.emitted('navegar')[0]).toEqual(['ep2']);
  });

  it('con una sola visita la barra sigue ahí y lo explica', async () => {
    const w = await montar({ visitas: [VISITAS[0]] });
    expect(w.find('.ficha-nav').exists()).toBe(true);
    expect(w.find('.ficha-nav-pos').text()).toContain('único episodio registrado de este paciente');
    expect(w.findAll('.ficha-nav-btn').every((b) => b.element.disabled)).toBe(true);
  });

  it('distingue "buscando las visitas" de "no se pudieron listar"', async () => {
    const w = await montar({ visitas: [], cargandoVisitas: true });
    expect(w.find('.ficha-nav-pos').text()).toContain('buscando los otros episodios');
    await w.setProps({ cargandoVisitas: false });
    expect(w.find('.ficha-nav-pos').text()).toContain('no se pudieron listar');
  });

  it('editar usa el mismo formulario del chat, sin sus acciones de conversación', async () => {
    const w = await montar();
    await w.findAll('.ficha-grupo')[1].find('.ficha-editar').trigger('click');
    const form = w.findComponent(BotForm);
    expect(form.props('form').id).toBe('ficha_grp_b');
    expect(form.props('form').actions).toBeUndefined();
    expect(w.findAll('.ficha-grupo')[1].find('.ficha-editar').text()).toBe('Cancelar');
    await w.findAll('.ficha-grupo')[1].find('.ficha-editar').trigger('click');
    expect(w.findComponent(BotForm).exists()).toBe(false);
  });

  it('guardar persiste el grupo, recarga la ficha y avisa el avance', async () => {
    api.guardarGrupoFicha.mockResolvedValue({ completitud: 75 });
    const w = await montar();
    await w.findAll('.ficha-grupo')[1].find('.ficha-editar').trigger('click');
    w.findComponent(BotForm).vm.$emit('submit', { form_id: 'ficha_grp_b', data: { campo_b: 'nuevo' } });
    await flushPromises();
    expect(api.guardarGrupoFicha).toHaveBeenCalledWith({ groupId: 'b', data: { campo_b: 'nuevo' }, episodeId: 'ep2', patientId: 'p1' });
    expect(api.fichaCompleta).toHaveBeenCalledTimes(2);
    expect(w.find('.ficha-aviso').text()).toBe('Guardado · 75% de la ficha');
    expect(w.findComponent(BotForm).exists()).toBe(false);
  });

  it('si guardar falla lo dice en rojo y el formulario sigue abierto', async () => {
    api.guardarGrupoFicha.mockRejectedValue(new Error('sin permiso'));
    const w = await montar();
    await w.findAll('.ficha-grupo')[1].find('.ficha-editar').trigger('click');
    w.findComponent(BotForm).vm.$emit('submit', { form_id: 'ficha_grp_b', data: {} });
    await flushPromises();
    expect(w.find('.ficha-aviso--error').text()).toBe('sin permiso');
    expect(w.findComponent(BotForm).exists()).toBe(true);
  });

  it('al cambiar de visita recarga sin vaciar lo que se estaba viendo', async () => {
    const w = await montar();
    let soltar;
    api.fichaCompleta.mockReturnValue(new Promise((r) => { soltar = r; }));
    await w.setProps({ episodeId: 'ep1' });
    expect(w.find('.ficha-cargando').exists()).toBe(true);
    expect(w.findAll('.ficha-grupo')).toHaveLength(4);
    soltar(FICHA);
    await flushPromises();
    expect(w.find('.ficha-cargando').exists()).toBe(false);
  });

  it('estados: cargando la primera vez, error y ficha sin grupos', async () => {
    api.fichaCompleta.mockReturnValue(new Promise(() => {}));
    expect((await montar()).find('.ficha-estado').text()).toBe('Cargando ficha…');
    api.fichaCompleta.mockRejectedValue(new Error('HTTP 404'));
    expect((await montar()).find('.ficha-error').text()).toBe('HTTP 404');
    api.fichaCompleta.mockResolvedValue({ grupos: [] });
    expect((await montar()).find('.ficha-estado').text()).toBe('Esta ficha no tiene grupos.');
  });

  it('muestra los valores legibles: sí/no, opciones por su etiqueta y listas', async () => {
    api.fichaCompleta.mockResolvedValue({ completos: 1, total: 1, grupos: [grupo('z', { form: {
      id: 'f', fields: [
        { key: 'b', label: 'Booleano' }, { key: 'o', label: 'Opción', options: [{ label: 'Grave', value: 'g' }] },
        { key: 'l', label: 'Lista' }, { key: 'v', label: 'Vacío' },
      ],
      values: { b: false, o: 'g', l: ['uno', { label: 'dos' }], v: '' },
    } })] });
    const w = await montar({ visitas: [] });
    expect(w.findAll('dd').map((d) => d.text())).toEqual(['No', 'Grave', 'uno, dos']);
  });
});
