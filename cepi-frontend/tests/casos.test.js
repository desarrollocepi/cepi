// El portal de casos (PAPER §22): las dos listas, el shell con la URL como estado y el
// visor de formatos documentales.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { h, defineComponent } from 'vue';

vi.mock('../src/api.js', () => ({
  listarCasos: vi.fn(), listarPacientes: vi.fn(), listarPacientesBusqueda: vi.fn(),
  listarCasosDePaciente: vi.fn(), obtenerEntidad: vi.fn(), switchOrgToEpisodio: vi.fn(),
  switchOrgToPaciente: vi.fn(), guardarFichaCompleta: vi.fn(),
}));
import * as api from '../src/api.js';
import CasoLista from '../src/components/CasoLista.vue';
import PacienteLista from '../src/components/PacienteLista.vue';
import CasosShell from '../src/components/CasosShell.vue';
import VisorFormato from '../src/components/VisorFormato.vue';

const caso = (n, extra = {}) => ({ id: 'e' + n, patient_id: 'p' + n, fecha: '2026-10-0' + (n % 9 + 1) + 'T00:00:00Z', estado: 'en_curso', ficha_completitud: 50, ...extra });
const pagina = (n, desde = 0) => Array.from({ length: n }, (_, i) => caso(desde + i + 1));

describe('CasoLista', () => {
  beforeEach(() => {
    api.listarCasos.mockResolvedValue({ data: [
      caso(1, { diagnostico: 'Psoriasis', codigo_cie10: 'L40', ficha_completitud: 80, drpro_cita_id: 77 }),
      caso(2, { motivo_consulta: 'mancha', ficha_completitud: 40, ficha_faltantes: 'Examen físico' }),
      caso(3, { ficha_completitud: null, tipo_cita: 'control' }),
      caso(4, { ficha_completitud: 10 }),
    ] });
    api.listarPacientes.mockResolvedValue({ data: [{ id: 'p1', nombre: 'Ana', apellidos: 'Pérez' }, { id: 'p2', cedula: '0202' }] });
  });
  async function montar(props = {}) { const w = mount(CasoLista, { props }); await flushPromises(); return w; }

  it('busca al abrir, con los filtros por defecto, y resuelve los nombres en un solo lote', async () => {
    const w = await montar();
    expect(api.listarCasos).toHaveBeenCalledWith({ q: '', codigo_cie10: '', estado: '', desde: '', hasta: '', origen: '', deuda: '', orden: '-fecha', limit: 40, offset: 0 });
    expect(api.listarPacientes).toHaveBeenCalledTimes(1);
    expect(api.listarPacientes).toHaveBeenCalledWith({ ids: ['p1', 'p2', 'p3', 'p4'] });
    expect(w.findAll('.cl-paciente').map((p) => p.text())).toEqual(['Ana Pérez', '0202', '—', '—']);
    expect(w.find('.cl-cuenta').text()).toBe('4 episodios');
  });

  it('cada fila resume el caso: diagnóstico, si no el motivo, si no el tipo de cita', async () => {
    const w = await montar();
    expect(w.findAll('.cl-dx').map((d) => d.text().replace(/\s+/g, ' '))).toEqual(['L40 Psoriasis', 'mancha', 'control', 'Sin diagnóstico registrado']);
    expect(w.findAll('.cl-tag--drpro')).toHaveLength(1);
  });

  it('el llenado va en color por tramos, dice qué falta y distingue "nunca calculado"', async () => {
    const w = await montar();
    const pcts = w.findAll('.cl-pct');
    expect(pcts.map((p) => p.text())).toEqual(['80%', '40%', 's/c', '10%']);
    expect(pcts[0].classes()).toContain('cl-pct--alto');
    expect(pcts[1].classes()).toContain('cl-pct--medio');
    expect(pcts[1].attributes('title')).toBe('Falta: Examen físico');
    expect(pcts[2].classes()).toContain('cl-pct--nc');
    expect(pcts[3].classes()).toContain('cl-pct--bajo');
    expect(w.find('.cl-falta').text()).toBe('Falta: Examen físico');
  });

  it('elegir una fila emite el episodio y su paciente; la activa queda marcada', async () => {
    const w = await montar({ activeId: 'e2' });
    expect(w.findAll('.cl-item')[1].classes()).toContain('cl-item--sel');
    await w.findAll('.cl-item')[0].trigger('click');
    expect(w.emitted('select')[0]).toEqual([{ episodeId: 'e1', patientId: 'p1' }]);
  });

  it('"Buscar" manda los filtros y REINICIA la lista', async () => {
    const w = await montar();
    await w.find('input[type="search"]').setValue(' psoriasis ');
    await w.find('input[placeholder="CIE-10"]').setValue('L40');
    api.listarCasos.mockResolvedValue({ data: [caso(9)] });
    await w.find('.cl-btn').trigger('click');
    await flushPromises();
    expect(api.listarCasos).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'psoriasis', codigo_cie10: 'L40', offset: 0 }));
    expect(w.findAll('.cl-item')).toHaveLength(1);
  });

  it('Enter en el buscador también reinicia: no pagina sobre los resultados viejos', async () => {
    const w = await montar();
    api.listarCasos.mockResolvedValue({ data: [caso(9)] });
    await w.find('input[type="search"]').setValue('x');
    await w.find('input[type="search"]').trigger('keyup.enter');
    await flushPromises();
    expect(api.listarCasos).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'x', offset: 0 }));
    expect(w.findAll('.cl-item')).toHaveLength(1);
    await w.find('input[placeholder="CIE-10"]').trigger('keyup.enter');
    await flushPromises();
    expect(api.listarCasos).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
  });

  it('"Ver más" pagina; sin más resultados queda gris diciendo por qué', async () => {
    api.listarCasos.mockResolvedValueOnce({ data: pagina(40) });
    const w = await montar();
    expect(w.find('.cl-cuenta').text()).toBe('40+ episodios');
    expect(w.find('.cl-mas').element.disabled).toBe(false);
    api.listarCasos.mockResolvedValueOnce({ data: pagina(3, 40) });
    await w.find('.cl-mas').trigger('click');
    await flushPromises();
    expect(api.listarCasos).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 40 }));
    expect(w.findAll('.cl-item')).toHaveLength(43);
    expect(w.find('.cl-mas').element.disabled).toBe(true);
    expect(w.find('.cl-mas').text()).toBe('No hay más resultados');
    expect(w.find('.cl-mas').attributes('title')).toBe('Ya se listaron todos los episodios');
  });

  it('vacío, error, y que la lista sirve aunque no lleguen los nombres', async () => {
    api.listarPacientes.mockRejectedValue(new Error('x'));
    expect((await montar()).findAll('.cl-item')).toHaveLength(4);
    api.listarCasos.mockResolvedValue({ data: [] });
    expect((await montar()).find('.cl-estado').text()).toBe('Ningún episodio con esos criterios.');
    api.listarCasos.mockRejectedValue(new Error('HTTP 500'));
    expect((await montar()).find('.cl-error').text()).toBe('HTTP 500');
  });
});

describe('PacienteLista', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    api.listarPacientesBusqueda.mockResolvedValue({ data: [
      { id: 'p1', nombre: 'Ana', apellidos: 'Pérez', cedula: '0101', sector_ciudad: 'Quito', fecha_nac: '1990-10-09', drpro_id: 5 },
      { id: 'p2' },
    ] });
  });
  async function montar(props = {}) { const w = mount(PacienteLista, { props }); await flushPromises(); return w; }

  it('lista con nombre, cédula, ciudad y la edad calculada (aún no cumple años)', async () => {
    const w = await montar();
    vi.useRealTimers();
    expect(api.listarPacientesBusqueda).toHaveBeenCalledWith({ q: '', origen: '', limit: 40, offset: 0 });
    expect(w.findAll('.pl-nombre').map((n) => n.text())).toEqual(['Ana Pérez', '(sin nombre)']);
    expect(w.findAll('.pl-sub')[0].text().replace(/\s+/g, ' ')).toBe('0101 Quito · 35 años');
    expect(w.findAll('.pl-sub')[1].text()).toBe('—');
    expect(w.findAll('.pl-tag--drpro')).toHaveLength(1);
    expect(w.find('.pl-cuenta').text()).toBe('2 pacientes');
  });

  it('elegir emite el paciente; buscar con Enter o con el botón reinicia', async () => {
    const w = await montar({ activeId: 'p2' });
    vi.useRealTimers();
    expect(w.findAll('.pl-item')[1].classes()).toContain('pl-item--sel');
    await w.findAll('.pl-item')[0].trigger('click');
    expect(w.emitted('select')[0]).toEqual([{ patientId: 'p1' }]);
    await w.find('input[type="search"]').setValue('ana');
    await w.find('input[type="search"]').trigger('keyup.enter');
    await flushPromises();
    expect(api.listarPacientesBusqueda).toHaveBeenLastCalledWith({ q: 'ana', origen: '', limit: 40, offset: 0 });
    await w.find('select').setValue('drpro');
    await w.find('.pl-btn').trigger('click');
    await flushPromises();
    expect(api.listarPacientesBusqueda).toHaveBeenLastCalledWith({ q: 'ana', origen: 'drpro', limit: 40, offset: 0 });
  });

  it('vacío y error', async () => {
    api.listarPacientesBusqueda.mockResolvedValue({ data: [] });
    expect((await montar()).find('.pl-estado').text()).toBe('Ningún paciente con esos criterios.');
    api.listarPacientesBusqueda.mockRejectedValue(new Error('HTTP 500'));
    expect((await montar()).find('.pl-error').text()).toBe('HTTP 500');
    vi.useRealTimers();
  });
});

describe('CasosShell', () => {
  const doble = (name, props, emits = []) => defineComponent({ name, props, emits, render: () => h('div', { class: name }) });
  const CasoListaD = doble('CasoLista', ['activeId'], ['select']);
  const PacienteListaD = doble('PacienteLista', ['activeId'], ['select']);
  const FichaD = doble('FichaCompleta', ['episodeId', 'patientId', 'visitas', 'cargandoVisitas'], ['navegar']);
  const VisorD = doble('VisorFormato', ['src', 'titulo', 'episodeId', 'patientId', 'visitas'], ['guardado']);
  const VISITAS = [
    { id: 'e2', patient_id: 'p1', fecha: '2026-10-01T00:00:00Z', estado: 'en_curso', codigo_cie10: 'L40', diagnostico: 'Psoriasis' },
    { id: 'e1', patient_id: 'p1', fecha: '2026-09-01T00:00:00Z', estado: 'cerrado', motivo_consulta: 'mancha' },
  ];
  let recargas;
  async function montar(ruta = '/casos') {
    const vacio = { render: () => null };
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/casos', name: 'casos', component: vacio },
      { path: '/casos/caso/:episodeId', name: 'caso', component: vacio },
      { path: '/casos/paciente/:patientId', name: 'paciente', component: vacio },
    ] });
    await router.push(ruta);
    const w = mount(CasosShell, { props: { user: {} }, global: { plugins: [router], stubs: { CasoLista: CasoListaD, PacienteLista: PacienteListaD, FichaCompleta: FichaD, VisorFormato: VisorD } } });
    await flushPromises();
    return { w, router };
  }
  const formato = (w, texto) => w.findAll('.cshell-formatos button').find((b) => b.text() === texto);

  beforeEach(() => {
    recargas = 0;
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: () => { recargas++; } }, configurable: true, writable: true });
    api.listarCasosDePaciente.mockResolvedValue({ data: VISITAS });
    api.obtenerEntidad.mockResolvedValue({ id: 'e2', patient_id: 'p1' });
    api.switchOrgToEpisodio.mockResolvedValue('igual');
    api.switchOrgToPaciente.mockResolvedValue('igual');
  });

  it('sin nada abierto pide elegir, según la pestaña', async () => {
    const { w } = await montar();
    expect(w.find('.cshell-vacio').text()).toBe('Elige un episodio de la lista.');
    await w.findAll('.cshell-tabs button')[1].trigger('click');
    expect(w.find('.cshell-vacio').text()).toBe('Elige un paciente de la lista.');
  });

  it('elegir un episodio navega a su URL y abre su ficha con las visitas del paciente', async () => {
    const { w, router } = await montar();
    w.findComponent(CasoListaD).vm.$emit('select', { episodeId: 'e2', patientId: 'p1' });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/casos/caso/e2');
    expect(api.listarCasosDePaciente).toHaveBeenCalledWith('p1');
    expect(w.findComponent(FichaD).props()).toMatchObject({ episodeId: 'e2', patientId: 'p1' });
    expect(w.findComponent(FichaD).props('visitas')).toHaveLength(2);
    expect(w.find('.cshell-titulo').text()).toBe('Ficha del episodio');
  });

  it('moverse entre visitas hermanas no vuelve a pedir ni el paciente ni la lista', async () => {
    const { w, router } = await montar('/casos/caso/e2');
    api.obtenerEntidad.mockClear(); api.listarCasosDePaciente.mockClear();
    w.findComponent(FichaD).vm.$emit('navegar', 'e1');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/casos/caso/e1');
    expect(w.findComponent(FichaD).props('episodeId')).toBe('e1');
    expect(api.obtenerEntidad).not.toHaveBeenCalled();
    expect(api.listarCasosDePaciente).not.toHaveBeenCalled();
  });

  it('abrir un paciente lleva a la ficha de su episodio más reciente', async () => {
    const { w, router } = await montar('/casos/paciente/p1');
    expect(router.currentRoute.value.fullPath).toBe('/casos/caso/e2');
    expect(w.findComponent(FichaD).props('episodeId')).toBe('e2');
    expect(w.findAll('.cshell-tabs button')[1].classes()).toContain('on');
  });

  it('un paciente sin episodios lo dice; no pinta una ficha de paciente', async () => {
    api.listarCasosDePaciente.mockResolvedValue({ data: [] });
    const { w } = await montar('/casos/paciente/p1');
    expect(w.find('.cshell-vacio').text()).toBe('Este paciente no tiene episodios registrados todavía.');
    expect(w.findComponent(FichaD).exists()).toBe(false);
  });

  it('si los episodios no cargan muestra el error con Reintentar, no "no tiene episodios"', async () => {
    api.listarCasosDePaciente.mockRejectedValueOnce(new Error('HTTP 503'));
    const { w, router } = await montar('/casos/paciente/p1');
    expect(w.find('.cshell-ajeno').text()).toContain('No se pudieron cargar los episodios: HTTP 503');
    await w.find('.cshell-reintentar').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/casos/caso/e2');
  });

  it('un enlace a un registro de otra org propia cambia de organización y recarga', async () => {
    api.obtenerEntidad.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }));
    api.switchOrgToEpisodio.mockResolvedValue('cambiada');
    await montar('/casos/caso/e9');
    expect(api.switchOrgToEpisodio).toHaveBeenCalledWith('e9');
    expect(recargas).toBe(1);
  });

  it('un registro de una org ajena lo dice en claro y no muestra nada', async () => {
    api.obtenerEntidad.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }));
    api.switchOrgToEpisodio.mockResolvedValue('ajena');
    const { w } = await montar('/casos/caso/e9');
    expect(w.find('.cshell-ajeno').text()).toContain('pertenece a otra organización');
    expect(w.findComponent(FichaD).exists()).toBe(false);
    expect(recargas).toBe(0);
  });

  it('el acordeón de episodios arranca plegado, resume el que se ve y recuerda la elección', async () => {
    const { w } = await montar('/casos/caso/e2');
    expect(w.find('.cshell-visitas-cuenta').text()).toBe('2');
    expect(w.find('.cshell-visitas-hint').text()).toBe('2026-10-01 · L40 · en_curso');
    expect(w.find('.cshell-visitas ul').element.style.display).toBe('none');
    await w.find('.cshell-acordeon').trigger('click');
    expect(w.find('.cshell-visitas ul').element.style.display).toBe('');
    expect(localStorage.getItem('cepi.casos.visitasAbiertas')).toBe('1');
    const filas = w.findAll('.cshell-visitas li');
    expect(filas[0].find('.cshell-v-actual').exists()).toBe(true);
    expect(filas[1].find('.cshell-v-dx').text()).toBe('mancha');
    expect((await montar('/casos/caso/e2')).w.find('.cshell-visitas ul').element.style.display).toBe('');
  });

  it('el formato elegido se conserva al cambiar de caso y entre sesiones', async () => {
    const { w, router } = await montar('/casos/caso/e2');
    expect(w.findAll('.cshell-formatos button').map((b) => b.text())).toEqual(['Grupos', 'Ficha HCU', 'MSP 002', 'MSP 053']);
    await formato(w, 'MSP 002').trigger('click');
    expect(w.findComponent(VisorD).props()).toMatchObject({ src: '/msp-002.html', episodeId: 'e2', patientId: 'p1' });
    expect(w.findComponent(FichaD).exists()).toBe(false);
    await router.push('/casos/caso/e1'); await flushPromises();
    expect(w.findComponent(VisorD).props('episodeId')).toBe('e1');
    expect(localStorage.getItem('cepi.casos.formato')).toBe('msp002');
    expect((await montar('/casos/caso/e2')).w.findComponent(VisorD).props('src')).toBe('/msp-002.html');
  });

  it('tras guardar desde un formato se recarga la lista de episodios', async () => {
    localStorage.setItem('cepi.casos.formato', 'ficha');
    const { w } = await montar('/casos/caso/e2');
    api.listarCasosDePaciente.mockClear();
    w.findComponent(VisorD).vm.$emit('guardado', { ok: true });
    await flushPromises();
    expect(api.listarCasosDePaciente).toHaveBeenCalledWith('p1');
  });

  it('"‹" vuelve a la lista y suelta lo abierto', async () => {
    const { w, router } = await montar('/casos/caso/e2');
    await w.find('.cshell-volver').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/casos');
    expect(w.findComponent(FichaD).exists()).toBe(false);
    expect(w.classes()).toContain('cshell--lista');
  });
});

describe('VisorFormato', () => {
  /** Un documento falso con el contrato de los formatos de `public/`. */
  function documento({ editable = true, cubre = true } = {}) {
    const oyentes = {};
    const win = {
      datos: {}, cambios: null, impreso: 0, enfocado: 0,
      fillFicha(d) { win.datos = { ...d }; },
      markChanges(c) { win.cambios = c; },
      document: { addEventListener: (ev, fn) => { oyentes[ev] = fn; } },
      focus() { win.enfocado++; }, print() { win.impreso++; },
      escribir(k, v) { win.datos[k] = v; oyentes.input?.(); },
    };
    if (editable) win.readFicha = () => ({ ...win.datos });
    if (!cubre) win.camposNoCubiertos = () => ['a', 'b'];
    return win;
  }
  async function montar(win, props = {}) {
    const w = mount(VisorFormato, { props: { src: '/ficha.html', titulo: 'Historia', episodeId: 'e2', patientId: 'p1', visitas: [], ...props } });
    Object.defineProperty(w.find('iframe').element, 'contentWindow', { value: win, configurable: true });
    await w.find('iframe').trigger('load');
    await flushPromises();
    return w;
  }
  const guardar = (w) => w.find('.visor-btn--guardar');
  const imprimir = (w) => w.findAll('.visor-btn')[1];

  beforeEach(() => {
    api.obtenerEntidad.mockImplementation(async (id) => (id === 'p1'
      ? { nombre: 'Ana', apellidos: 'Pérez', fecha_nac: '1990-01-01', cedula: '0101' }
      : { id: 'e2', motivo_consulta: 'mancha', diagnostico: 'Psoriasis', estado: 'en_curso' }));
  });

  it('rellena el documento con paciente + episodio, el nombre completo y la edad', async () => {
    const win = documento();
    await montar(win);
    expect(win.datos).toMatchObject({ nombre: 'Ana Pérez', cedula: '0101', motivo_consulta: 'mancha', diagnostico: 'Psoriasis' });
    expect(win.datos.edad).toBeGreaterThan(30);
  });

  it('marca lo que cambió respecto de la visita anterior, sin los campos que cambian siempre', async () => {
    const win = documento();
    await montar(win, { visitas: [{ id: 'e2' }, { id: 'e1', diagnostico: 'Dermatitis', estado: 'cerrado', motivo_consulta: 'mancha' }] });
    expect(win.cambios).toEqual({ diagnostico: 'Dermatitis' });
  });

  it('Guardar arranca gris ("no hay cambios") y se habilita al editar el documento', async () => {
    const win = documento();
    const w = await montar(win);
    expect(guardar(w).element.disabled).toBe(true);
    expect(guardar(w).attributes('title')).toBe('No hay cambios que guardar');
    win.escribir('diagnostico', 'Vitiligo');
    await flushPromises();
    expect(guardar(w).element.disabled).toBe(false);
    win.escribir('diagnostico', 'Psoriasis');   // se deshizo el cambio
    await flushPromises();
    expect(guardar(w).element.disabled).toBe(true);
  });

  it('guarda el documento entero, avisa cuánto y vuelve a quedar sin cambios', async () => {
    api.guardarFichaCompleta.mockResolvedValue({ ok: true, camposPaciente: 0, camposEpisodio: 1, completitud: 60 });
    const win = documento();
    const w = await montar(win);
    win.escribir('diagnostico', 'Vitiligo');
    await flushPromises();
    await guardar(w).trigger('click');
    await flushPromises();
    expect(api.guardarFichaCompleta).toHaveBeenCalledWith({ episodeId: 'e2', patientId: 'p1', data: expect.objectContaining({ diagnostico: 'Vitiligo' }) });
    expect(w.find('.visor-estado').text()).toBe('Guardado · 1 campo · ficha al 60%');
    expect(guardar(w).element.disabled).toBe(true);
    expect(w.emitted('guardado')).toHaveLength(1);
  });

  it('si el guardado falla o viene con errores lo dice y los cambios siguen pendientes', async () => {
    const win = documento();
    const w = await montar(win);
    win.escribir('diagnostico', 'Vitiligo'); await flushPromises();
    api.guardarFichaCompleta.mockRejectedValueOnce(new Error('sin permiso'));
    await guardar(w).trigger('click'); await flushPromises();
    expect(w.find('.visor-error').text()).toBe('sin permiso');
    expect(guardar(w).element.disabled).toBe(false);
    api.guardarFichaCompleta.mockResolvedValueOnce({ ok: false, errores: ['fecha inválida'] });
    await guardar(w).trigger('click'); await flushPromises();
    expect(w.find('.visor-error').text()).toBe('Guardado con errores: fecha inválida');
  });

  it('un formato generado (sin readFicha) no se puede guardar, y el botón explica por qué', async () => {
    const w = await montar(documento({ editable: false }), { src: '/msp-002.html' });
    expect(guardar(w).element.disabled).toBe(true);
    expect(guardar(w).attributes('title')).toContain('documento generado');
    expect(imprimir(w).element.disabled).toBe(false);
  });

  it('imprimir imprime solo el documento', async () => {
    const win = documento();
    const w = await montar(win);
    await imprimir(w).trigger('click');
    expect(win.impreso).toBe(1);
    expect(win.enfocado).toBe(1);
  });

  it('avisa cuando hay datos que no caben en el formato', async () => {
    const w = await montar(documento({ cubre: false }));
    expect(w.find('.visor-aviso').text()).toBe('2 campos con dato no caben en este formato');
  });

  it('si el documento no cumple el contrato, la barra sigue y los botones quedan grises con motivo', async () => {
    const w = await montar({});
    expect(w.find('.visor-error').text()).toBe('Este formato no expone fillFicha().');
    expect(guardar(w).element.disabled).toBe(true);
    expect(guardar(w).attributes('title')).toBe('El formato no cargó');
    expect(imprimir(w).element.disabled).toBe(true);
    expect(imprimir(w).attributes('title')).toBe('El formato no cargó');
  });

  it('al cambiar de episodio rellena de nuevo sobre el mismo documento', async () => {
    const win = documento();
    const w = await montar(win);
    api.obtenerEntidad.mockImplementation(async (id) => (id === 'p1' ? { nombre: 'Ana' } : { id: 'e1', diagnostico: 'Otro' }));
    await w.setProps({ episodeId: 'e1' });
    await flushPromises();
    expect(win.datos.diagnostico).toBe('Otro');
    expect(api.obtenerEntidad).toHaveBeenCalledWith('e1');
  });
});
