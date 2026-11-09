import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({
  listGroups: vi.fn(),
  listGroupMembers: vi.fn(),
  listarTurnos: vi.fn(),
  asignarTurno: vi.fn(),
  quitarTurno: vi.fn(),
}));
import * as api from '../src/api.js';
import Turnos from '../src/components/Turnos.vue';

// Miércoles 2026-11-11: la semana en curso va del lunes 9 al domingo 15.
const HOY = '2026-11-11';
const editor = { permissions: ['groups:read', 'groups:manage_shifts'] };
const lector = { permissions: ['groups:read'] };

function preparar(turnos = []) {
  api.listGroups.mockResolvedValue({ data: [
    { slug: 'todos', name: 'Todos', kind: 'all' },
    { slug: 'turno', name: 'Médicos en turno', kind: 'roster' },
    { slug: 'dermatologia', name: 'Dermatología', kind: 'specialty' },
  ] });
  api.listGroupMembers.mockResolvedValue({ data: [
    { user_id: 'u1', name: 'Dra. Ana' }, { user_id: 'u2', name: 'Dra. Gaby' },
  ] });
  api.listarTurnos.mockResolvedValue({ data: turnos, today: HOY });
}
const montar = (user) => mount(Turnos, { props: { user } });
const semana = (w, inicio) => w.find(`[data-semana="${inicio}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe('Turnos (PAPER §32)', () => {
  it('abre Dermatología, sin el grupo virtual, y muestra 8 semanas desde el lunes', async () => {
    preparar([{ id: 's1', user_id: 'u1', user_name: 'Dra. Ana', starts_on: '2026-11-09', ends_on: '2026-11-15' }]);
    const w = montar(editor);
    await flushPromises();
    const opciones = w.findAll('.tur-grupo option').map((o) => o.text());
    expect(opciones).toEqual(['Médicos en turno', 'Dermatología']);
    expect(w.find('.tur-grupo').element.value).toBe('dermatologia');
    expect(api.listarTurnos).toHaveBeenLastCalledWith('dermatologia', { from: '2026-11-09', to: '2027-01-03' });
    expect(w.findAll('.tur-semana')).toHaveLength(8);
    expect(semana(w, '2026-11-09').classes()).toContain('tur-actual');
    expect(semana(w, '2026-11-09').text()).toContain('Dra. Ana');
    expect(w.find('[data-test="de-turno-hoy"]').text()).toContain('Dra. Ana');
    expect(semana(w, '2026-11-16').text()).toContain('Sin asignar');
  });

  it('sin nadie hoy lo dice: avisa a todo el grupo', async () => {
    preparar([]);
    const w = montar(editor);
    await flushPromises();
    expect(w.find('[data-test="de-turno-hoy"]').text()).toContain('nadie asignado (avisa a todo el grupo)');
  });

  it('asignar una semana manda lunes a domingo y recarga', async () => {
    preparar([]);
    api.asignarTurno.mockResolvedValue({ ok: true });
    const w = montar(editor);
    await flushPromises();
    const s = semana(w, '2026-11-16');
    await s.find('select').setValue('u2');
    await s.find('.tur-btn').trigger('click');
    await flushPromises();
    expect(api.asignarTurno).toHaveBeenCalledWith('dermatologia', { userId: 'u2', startsOn: '2026-11-16', endsOn: '2026-11-22' });
    expect(api.listarTurnos).toHaveBeenCalledTimes(2);
    expect(w.find('.tur-aviso').text()).toContain('Dra. Gaby quedó de turno');
  });

  it('quitar un turno', async () => {
    preparar([{ id: 's1', user_id: 'u1', user_name: 'Dra. Ana', starts_on: '2026-11-09', ends_on: '2026-11-15' }]);
    api.quitarTurno.mockResolvedValue({ ok: true });
    const w = montar(editor);
    await flushPromises();
    await semana(w, '2026-11-09').find('.tur-quitar').trigger('click');
    await flushPromises();
    expect(api.quitarTurno).toHaveBeenCalledWith('dermatologia', 's1');
  });

  it('quien no tiene permiso ve el calendario sin controles de edición', async () => {
    preparar([{ id: 's1', user_id: 'u1', user_name: 'Dra. Ana', starts_on: '2026-11-09', ends_on: '2026-11-15' }]);
    const w = montar(lector);
    await flushPromises();
    expect(semana(w, '2026-11-09').text()).toContain('Dra. Ana');
    expect(w.find('.tur-asignar').exists()).toBe(false);
    expect(w.find('.tur-quitar').exists()).toBe(false);
  });

  it('un error al guardar se muestra', async () => {
    preparar([]);
    api.asignarTurno.mockRejectedValue(new Error('HTTP 400'));
    const w = montar(editor);
    await flushPromises();
    const s = semana(w, '2026-11-09');
    await s.find('select').setValue('u1');
    await s.find('.tur-btn').trigger('click');
    await flushPromises();
    expect(w.find('.tur-aviso').text()).toContain('No se pudo guardar: HTTP 400');
  });
});

describe('Turnos: el «hoy» del servidor manda', () => {
  it('si el dispositivo está en otra semana, vuelve a pedir la del servidor', async () => {
    preparar([]);
    vi.setSystemTime(new Date(2026, 10, 16, 1, 0, 0)); // lunes 16 en el dispositivo
    const w = montar(editor);
    await flushPromises();
    expect(api.listarTurnos.mock.calls.map((c) => c[1].from)).toEqual(['2026-11-16', '2026-11-09']);
    expect(w.findAll('.tur-semana')[0].attributes('data-semana')).toBe('2026-11-09');
  });
});
