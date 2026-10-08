import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({
  listPatients: vi.fn(),
  createPatient: vi.fn(),
  getReviewQueue: vi.fn(),
  getPatientAssignments: vi.fn(),
  eliminarPaciente: vi.fn(),
}));
import * as api from '../src/api.js';
import ChatList from '../src/components/ChatList.vue';

const DEF_PACIENTE = '11000000-0000-0000-0000-000000000000';
const paciente = (id, nombre, apellidos, cedula) => ({ id, data: { nombre, apellidos, cedula } });
const PACIENTES = [
  paciente('p1', 'Ana', 'Cerrada', '0101'),
  paciente('p2', 'José', 'Curso', '0202'),
  paciente('p3', 'Luis', 'Sinconsulta', '0303'),
  paciente('p4', 'Marta', 'Derivada', '0404'),
  paciente('p5', 'Raúl', 'Curso', '0505'),
  paciente('p6', 'Eva', 'Rara', '0606'),
];
const ASIGNACIONES = {
  p1: { estado: 'cerrado' },
  p2: { estado: 'en_curso', assignee_name: 'Dra. Uno', source: 'creador' },
  p4: { estado: 'derivada', assignee_name: 'Dr. Dos', source: 'derivado', derivados: [{ name: 'Dr. Dos' }, { name: 'Dra. Tres' }, { name: 'Dr. Cuatro' }] },
  p5: { estado: 'en_curso' },
  p6: { estado: 'estado_que_no_existe' },
};

function preparar({ cola = {}, asignaciones = ASIGNACIONES, pacientes = PACIENTES } = {}) {
  api.listPatients.mockResolvedValue({ data: pacientes });
  api.getReviewQueue.mockResolvedValue({ by_patient: cola });
  api.getPatientAssignments.mockResolvedValue({ assignments: asignaciones });
}
async function montar(props = {}) {
  const w = mount(ChatList, { props });
  await flushPromises();
  return w;
}
const nombres = (w) => w.findAll('.row .name').map((n) => n.text());
const filtro = (w, texto) => w.findAll('.filtro').find((b) => b.text().startsWith(texto));

beforeEach(() => { vi.useFakeTimers(); preparar(); });
afterEach(() => { vi.useRealTimers(); });

describe('ChatList — estado de la ficha', () => {
  it('ordena por estado: derivada, en curso, cerrada, otro, sin consulta', async () => {
    const w = await montar();
    expect(nombres(w)).toEqual(['Marta Derivada', 'José Curso', 'Raúl Curso', 'Ana Cerrada', 'Eva Rara', 'Luis Sinconsulta']);
  });

  it('cada fila lleva su LED con el color y la etiqueta; "sin consulta" va hueco', async () => {
    const w = await montar();
    const leds = w.findAll('.row .led');
    expect(leds).toHaveLength(6);
    expect(leds[0].attributes('title')).toBe('Ficha: Derivada');
    expect(leds[0].attributes('style')).toContain('#F59E0B');
    expect(leds[0].classes()).not.toContain('hueco');
    expect(leds[4].attributes('title')).toBe('Ficha: Otro estado');
    expect(leds[5].attributes('aria-label')).toBe('Ficha: Sin consulta');
    expect(leds[5].classes()).toContain('hueco');
  });

  it('dentro de un mismo estado, "revisar" sube y lo que vence antes va primero', async () => {
    preparar({ cola: {
      p5: { pending: 1, earliest_due: '2026-10-09T00:00:00Z' },
      p1: { pending: 2, earliest_due: '2026-10-01T00:00:00Z' },
    } });
    const w = await montar();
    // p5 pasa a p2 dentro de "en curso"; p1 tiene revisión pero sigue debajo: manda el estado.
    expect(nombres(w)).toEqual(['Marta Derivada', 'Raúl Curso', 'José Curso', 'Ana Cerrada', 'Eva Rara', 'Luis Sinconsulta']);
    expect(w.findAll('.row.to-review')).toHaveLength(2);
    expect(w.find('.rev-badge').attributes('title')).toContain('1 pendiente(s)');
  });

  it('los filtros muestran el conteo y los vacíos quedan deshabilitados, no ocultos', async () => {
    const w = await montar();
    expect(w.findAll('.filtro')).toHaveLength(11);   // Todos + los 10 estados, siempre
    expect(filtro(w, 'Todos').text()).toBe('Todos · 6');
    expect(filtro(w, 'En curso').text()).toBe('En curso · 2');
    expect(filtro(w, 'En curso').element.disabled).toBe(false);
    expect(filtro(w, 'Respondida').text()).toBe('Respondida · 0');
    expect(filtro(w, 'Respondida').element.disabled).toBe(true);
    expect(filtro(w, 'Respondida').attributes('title')).toContain('Ningún paciente');
  });

  it('elegir un estado filtra; tocarlo de nuevo lo suelta', async () => {
    const w = await montar();
    await filtro(w, 'En curso').trigger('click');
    expect(nombres(w)).toEqual(['José Curso', 'Raúl Curso']);
    expect(filtro(w, 'En curso').attributes('aria-pressed')).toBe('true');
    expect(filtro(w, 'Todos').attributes('aria-pressed')).toBe('false');
    await filtro(w, 'En curso').trigger('click');
    expect(nombres(w)).toHaveLength(6);
  });

  it('el filtro se combina con la búsqueda', async () => {
    const w = await montar();
    await filtro(w, 'En curso').trigger('click');
    await w.find('.search').setValue('raul');
    expect(nombres(w)).toEqual(['Raúl Curso']);
  });

  it('un estado elegido que se queda sin pacientes sigue habilitado para poder soltarlo', async () => {
    const w = await montar();
    await filtro(w, 'Derivada').trigger('click');
    preparar({ asignaciones: { ...ASIGNACIONES, p4: { estado: 'cerrado' } } });
    await vi.advanceTimersByTimeAsync(20000);
    await flushPromises();
    expect(nombres(w)).toEqual([]);
    expect(filtro(w, 'Derivada').element.disabled).toBe(false);
    expect(w.find('.empty').text()).toContain('Ningún paciente en «Derivada»');
  });
});

describe('ChatList — búsqueda', () => {
  it('ignora tildes y mayúsculas', async () => {
    const w = await montar();
    await w.find('.search').setValue('JOSE');
    expect(nombres(w)).toEqual(['José Curso']);
  });
  it('busca por cédula', async () => {
    const w = await montar();
    await w.find('.search').setValue('0404');
    expect(nombres(w)).toEqual(['Marta Derivada']);
  });
  it('sin resultados lo dice', async () => {
    const w = await montar();
    await w.find('.search').setValue('zzzz');
    expect(w.find('.empty').text()).toBe('Sin coincidencias');
  });
});

describe('ChatList — carga', () => {
  it('"Cargando pacientes…" hasta que llega la lista, y los filtros deshabilitados', async () => {
    let soltar;
    api.listPatients.mockReturnValue(new Promise((r) => { soltar = r; }));
    const w = mount(ChatList);
    await flushPromises();
    expect(w.find('.empty').text()).toBe('Cargando pacientes…');
    expect(w.findAll('.filtro').every((b) => b.element.disabled)).toBe(true);
    soltar({ data: [] });
    await flushPromises();
    expect(w.find('.empty').text()).toBe('No hay pacientes');
  });

  it('pide pacientes, cola y asignaciones a la vez', async () => {
    api.listPatients.mockReturnValue(new Promise(() => {}));
    mount(ChatList);
    await flushPromises();
    expect(api.getReviewQueue).toHaveBeenCalledTimes(1);
    expect(api.getPatientAssignments).toHaveBeenCalledTimes(1);
  });

  it('si falla la lista muestra el error con Reintentar, y reintentar la trae', async () => {
    api.listPatients.mockRejectedValueOnce(new Error('HTTP 503'));
    const w = await montar();
    expect(w.find('.error').text()).toContain('HTTP 503');
    preparar();
    await w.find('.reintentar').trigger('click');
    await flushPromises();
    expect(w.find('.error').exists()).toBe(false);
    expect(nombres(w)).toHaveLength(6);
  });

  it('un fallo de los accesorios no borra lo que ya había', async () => {
    preparar({ cola: { p2: { pending: 1 } } });
    const w = await montar();
    api.getReviewQueue.mockRejectedValue(new Error('x'));
    api.getPatientAssignments.mockRejectedValue(new Error('x'));
    await vi.advanceTimersByTimeAsync(20000);
    await flushPromises();
    expect(w.findAll('.row.to-review')).toHaveLength(1);
    expect(nombres(w)[0]).toBe('Marta Derivada');
  });

  it('refresca cada 20 s y deja de hacerlo al desmontarse', async () => {
    const w = await montar();
    expect(api.listPatients).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.listPatients).toHaveBeenCalledTimes(2);
    w.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.listPatients).toHaveBeenCalledTimes(2);
  });

  it('un fallo del refresco silencioso no pisa la lista ni muestra error', async () => {
    const w = await montar();
    api.listPatients.mockRejectedValue(new Error('sin red'));
    await vi.advanceTimersByTimeAsync(20000);
    await flushPromises();
    expect(w.find('.error').exists()).toBe(false);
    expect(nombres(w)).toHaveLength(6);
  });
});

describe('ChatList — filas y acciones', () => {
  it('"a cargo": con varias derivaciones nombra dos y resume el resto', async () => {
    const w = await montar();
    const acargo = w.findAll('.row')[0].find('.acargo');
    expect(acargo.text()).toContain('Dr. Dos, Dra. Tres +1');
    expect(acargo.attributes('title')).toContain('derivado a Dr. Dos, Dra. Tres, Dr. Cuatro');
  });

  it('elegir una fila emite select con el paciente', async () => {
    const w = await montar();
    await w.findAll('.row')[1].trigger('click');
    expect(w.emitted('select')[0][0].id).toBe('p2');
  });

  it('marca la fila activa', async () => {
    const w = await montar({ activeId: 'p4' });
    expect(w.findAll('.row')[0].classes()).toContain('active');
  });

  it('borrar solo lo ve quien tiene el permiso (excepción de "nunca ocultes un botón")', async () => {
    expect((await montar({ user: { permissions: [] } })).find('.borrar').exists()).toBe(false);
    expect((await montar({ user: { permissions: [`entity:${DEF_PACIENTE}:record:delete`] } })).findAll('.borrar')).toHaveLength(6);
    expect((await montar({ user: { permissions: ['*:*:*:*'] } })).findAll('.borrar')).toHaveLength(6);
  });

  it('borrar pide confirmación; cancelada no borra, aceptada quita la fila sin abrirla', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    api.eliminarPaciente.mockResolvedValue({});
    const w = await montar({ user: { permissions: ['*:*:*:*'] } });
    await w.find('.borrar').trigger('click');
    expect(api.eliminarPaciente).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    await w.find('.borrar').trigger('click');
    await flushPromises();
    expect(api.eliminarPaciente).toHaveBeenCalledWith('p4');
    expect(nombres(w)).not.toContain('Marta Derivada');
    expect(w.emitted('select')).toBeUndefined();
  });

  it('si el borrado falla lo dice y la fila sigue', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.eliminarPaciente.mockRejectedValue(new Error('HTTP 403'));
    const w = await montar({ user: { permissions: ['*:*:*:*'] } });
    await w.find('.borrar').trigger('click');
    await flushPromises();
    expect(w.find('.error').text()).toContain('No se pudo eliminar a Marta Derivada: HTTP 403');
    expect(nombres(w)).toHaveLength(6);
  });

  it('alta: "Crear" deshabilitado hasta tener nombre, apellido y cédula; al crear lo selecciona', async () => {
    api.createPatient.mockResolvedValue({ id: 'nuevo', data: { nombre: 'Nora', apellidos: 'Nueva', cedula: '0707' } });
    const w = await montar();
    await w.find('.newpat').trigger('click');
    const [nombre, apellido, cedula] = w.findAll('.createform input');
    const crear = w.find('.createform button[type="submit"]');
    expect(crear.element.disabled).toBe(true);
    await nombre.setValue(' Nora ');
    await apellido.setValue('Nueva');
    expect(crear.element.disabled).toBe(true);
    await cedula.setValue('0707');
    expect(crear.element.disabled).toBe(false);
    await w.find('.createform').trigger('submit');
    await flushPromises();
    expect(api.createPatient).toHaveBeenCalledWith({ nombre: 'Nora', apellidos: 'Nueva', cedula: '0707' });
    expect(w.emitted('select')[0][0].id).toBe('nuevo');
    expect(w.find('.createform').exists()).toBe(false);
  });

  it('alta: el error del backend se muestra en el formulario', async () => {
    api.createPatient.mockRejectedValue(new Error('cédula duplicada'));
    const w = await montar();
    await w.find('.newpat').trigger('click');
    const campos = w.findAll('.createform input');
    for (const c of campos) await c.setValue('x');
    await w.find('.createform').trigger('submit');
    await flushPromises();
    expect(w.find('.createform .error').text()).toBe('cédula duplicada');
  });
});
