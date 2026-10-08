import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({ listReminders: vi.fn(), completeReminder: vi.fn(), resolveReminderPatient: vi.fn() }));
import * as api from '../src/api.js';
import Notifications from '../src/components/Notifications.vue';

const aviso = (id, extra = {}) => ({ id, title: 'Revisión ' + id, status: 'pending', entity_id: 'ep-' + id, created_at: `2026-10-0${id}T10:00:00Z`, ...extra });

async function montar() {
  const w = mount(Notifications, { props: { user: { id: 'yo' } }, attachTo: document.body });
  await flushPromises();
  return w;
}
async function abrir(w) { await w.find('.notif-bell').trigger('click'); await flushPromises(); }

beforeEach(() => {
  vi.useFakeTimers();
  api.listReminders.mockResolvedValue({ data: [aviso(1), aviso(2, { created_by_name: 'Dr. Uno', message: 'mirar lesión' }), aviso(3, { status: 'done' })] });
  api.resolveReminderPatient.mockImplementation(async (eid) => ({ patient_id: 'pac-' + eid, patient_name: 'Paciente ' + eid }));
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('Notifications', () => {
  it('pide solo los avisos propios y la campana cuenta los que siguen activos', async () => {
    const w = await montar();
    expect(api.listReminders).toHaveBeenCalledWith({ owner_user_id: 'yo' });
    expect(w.find('.notif-count').text()).toBe('2');
    expect(w.find('.notif-panel').exists()).toBe(false);
  });

  it('sin avisos activos no hay contador', async () => {
    api.listReminders.mockResolvedValue({ data: [aviso(1, { status: 'done' }), aviso(2, { status: 'cancelled' })] });
    const w = await montar();
    expect(w.find('.notif-count').exists()).toBe(false);
  });

  it('la lista va de lo más nuevo a lo más viejo, con el paciente, quién derivó y el estado', async () => {
    const w = await montar();
    await abrir(w);
    const items = w.findAll('.notif-item');
    expect(items.map((i) => i.find('.ni-title').text())).toEqual(['Paciente ep-3', 'Paciente ep-2', 'Paciente ep-1']);
    expect(items[1].find('.ni-sub').text()).toContain('Derivó: Dr. Uno');
    expect(items[1].find('.ni-msg').text()).toBe('mirar lesión');
    expect(items.map((i) => i.find('.ni-status').text())).toEqual(['visto', 'pendiente', 'pendiente']);
    expect(items[0].find('.ni-done').exists()).toBe(false);   // lo ya visto no se vuelve a marcar
  });

  it('si el paciente no se puede resolver queda el título del aviso', async () => {
    api.resolveReminderPatient.mockRejectedValue(new Error('403'));
    const w = await montar();
    await abrir(w);
    expect(w.find('.ni-title').text()).toBe('Revisión 3');
  });

  it('tocar un aviso abre el paciente y cierra el panel', async () => {
    const w = await montar();
    await abrir(w);
    await w.findAll('.notif-item')[1].trigger('click');
    expect(w.emitted('open')[0][0]).toEqual({ id: 'pac-ep-2', name: 'Paciente ep-2' });
    expect(w.find('.notif-panel').exists()).toBe(false);
  });

  it('si no estaba resuelto lo resuelve al tocarlo; si no hay paciente, lo dice', async () => {
    api.resolveReminderPatient.mockResolvedValue({});
    const w = await montar();
    await abrir(w);
    api.resolveReminderPatient.mockResolvedValueOnce({ patient_id: 'p9', patient_name: 'Nueve' });
    await w.findAll('.notif-item')[0].trigger('click');
    await flushPromises();
    expect(w.emitted('open')[0][0]).toEqual({ id: 'p9', name: 'Nueve' });
    await abrir(w);
    await w.findAll('.notif-item')[0].trigger('click');
    await flushPromises();
    expect(w.find('.notif-error').text()).toBe('No se encontró el paciente de esta notificación.');
    expect(w.emitted('open')).toHaveLength(1);
  });

  it('"Visto" lo marca sin abrir el paciente y baja el contador', async () => {
    api.completeReminder.mockResolvedValue({});
    const w = await montar();
    await abrir(w);
    await w.findAll('.notif-item')[1].find('.ni-done').trigger('click');
    await flushPromises();
    expect(api.completeReminder).toHaveBeenCalledWith(2, 'Visto desde el asistente');
    expect(w.emitted('open')).toBeUndefined();
    expect(w.find('.notif-count').text()).toBe('1');
  });

  it('si marcar falla lo dice y el aviso sigue pendiente', async () => {
    api.completeReminder.mockRejectedValue(new Error('HTTP 500'));
    const w = await montar();
    await abrir(w);
    await w.findAll('.notif-item')[1].find('.ni-done').trigger('click');
    await flushPromises();
    expect(w.find('.notif-error').text()).toBe('HTTP 500');
    expect(w.find('.notif-count').text()).toBe('2');
  });

  it('un clic fuera cierra el panel; dentro no', async () => {
    const w = await montar();
    await abrir(w);
    await w.find('.notif-head').trigger('click');
    expect(w.find('.notif-panel').exists()).toBe(true);
    document.body.click();
    await flushPromises();
    expect(w.find('.notif-panel').exists()).toBe(false);
  });

  it('vacío y error', async () => {
    api.listReminders.mockResolvedValue({ data: [] });
    const w = await montar();
    await abrir(w);
    expect(w.find('.notif-muted').text()).toContain('notificaciones');
    api.listReminders.mockRejectedValue(new Error('HTTP 503'));
    await w.find('.notif-refresh').trigger('click');
    await flushPromises();
    expect(w.find('.notif-error').text()).toBe('HTTP 503');
  });

  it('refresca cada 30 s y deja de hacerlo al desmontarse', async () => {
    const w = await montar();
    expect(api.listReminders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.listReminders).toHaveBeenCalledTimes(2);
    w.unmount();
    await vi.advanceTimersByTimeAsync(90000);
    expect(api.listReminders).toHaveBeenCalledTimes(2);
  });
});
