import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../src/api.js';

const respuesta = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => { if (body === undefined) throw new Error('sin cuerpo'); return body; },
  blob: async () => new Blob(['x']),
});
let fetchMock;
const ultima = () => fetchMock.mock.calls.at(-1);
const cuerpo = () => JSON.parse(ultima()[1].body);

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async () => respuesta(200, {}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('api — cliente', () => {
  it('manda el Bearer cuando hay sesión y no lo manda cuando no', async () => {
    await api.getReviewQueue();
    expect(ultima()[1].headers.Authorization).toBeUndefined();
    localStorage.setItem('cepi.jwt', 'tok');
    await api.getPatientAssignments();
    expect(ultima()[0]).toBe('/api/patient-assignments');
    expect(ultima()[1].headers.Authorization).toBe('Bearer tok');
  });

  it('archivados: la lista pide los inactivos y restaurar es un PATCH con restore=true', async () => {
    await api.listarPacientesArchivados();
    expect(ultima()[0]).toContain('/api/entities?type=business&entity_id=11000000-0000-0000-0000-000000000000&active=false');
    await api.restaurarPaciente('p 1');
    expect(ultima()[0]).toContain('/api/entities/p%201?record_type=business&restore=true');
    expect(ultima()[1].method).toBe('PATCH');
  });

  it('un error lleva el mensaje del backend y el código HTTP', async () => {
    fetchMock.mockResolvedValue(respuesta(404, { error: 'no existe' }));
    await expect(api.obtenerEntidad('x')).rejects.toMatchObject({ message: 'no existe', status: 404 });
  });

  it('sin cuerpo JSON el mensaje es el código', async () => {
    fetchMock.mockResolvedValue(respuesta(502));
    await expect(api.getReviewQueue()).rejects.toMatchObject({ message: 'HTTP 502', status: 502 });
  });

  it('login guarda el token y avisa a la capa de push', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { token: 'nuevo' }));
    const aviso = vi.fn();
    window.addEventListener('cepi:auth', aviso);
    await api.login('a@b.c', 'clave');
    expect(cuerpo()).toEqual({ email: 'a@b.c', password: 'clave' });
    expect(localStorage.getItem('cepi.jwt')).toBe('nuevo');
    expect(aviso).toHaveBeenCalledTimes(1);
    window.removeEventListener('cepi:auth', aviso);
  });

  it('logout borra token y sesión de chat, y avisa', () => {
    localStorage.setItem('cepi.jwt', 't');
    localStorage.setItem('cepi.session_id', 's');
    const aviso = vi.fn();
    window.addEventListener('cepi:logout', aviso);
    api.logout();
    expect(localStorage.getItem('cepi.jwt')).toBeNull();
    expect(localStorage.getItem('cepi.session_id')).toBeNull();
    expect(aviso).toHaveBeenCalledTimes(1);
    window.removeEventListener('cepi:logout', aviso);
  });

  it('eliminar la cuenta exige la confirmación explícita en el cuerpo', async () => {
    await api.deleteAccount();
    expect(ultima()[0]).toBe('/api/auth/me');
    expect(ultima()[1].method).toBe('DELETE');
    expect(cuerpo()).toEqual({ confirm: true });
  });
});

describe('api — URLs', () => {
  it('galería: límite y offset siempre; q y paciente solo si vienen', async () => {
    await api.galeria();
    expect(ultima()[0]).toBe('/api/bot/galeria?limit=60&offset=0');
    await api.galeria({ q: ' L40 ', patientId: 'p1', offset: 60 });
    expect(ultima()[0]).toBe('/api/bot/galeria?limit=60&offset=60&q=L40&patient_id=p1');
  });

  it('hilo del paciente y derivaciones escapan el id', async () => {
    await api.getPatientThread('a b');
    expect(ultima()[0]).toBe('/api/patient-thread?patient_id=a%20b');
    await api.listEntityDerivations('e/1');
    expect(ultima()[0]).toBe('/api/review-queue/entity/e%2F1');
  });

  it('una imagen se baja con el token y se entrega como blob', async () => {
    localStorage.setItem('cepi.jwt', 'tok');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    expect(await api.fetchAttachmentObjectUrl('/api/attachments/a/file')).toBe('blob:x');
    expect(ultima()[1].headers.Authorization).toBe('Bearer tok');
    fetchMock.mockResolvedValue(respuesta(404));
    await expect(api.fetchAttachmentObjectUrl('/api/attachments/a/file')).rejects.toThrow('HTTP 404');
  });
});

describe('api — chat y cola sin conexión', () => {
  it('arma el cuerpo: sesión, formulario y acción explícita solo si vienen', async () => {
    await api.chat('hola', null);
    expect(cuerpo()).toEqual({ message: 'hola' });
    await api.chat('derivar a x', 's1', { explicit: true });
    expect(cuerpo()).toEqual({ message: 'derivar a x', session_id: 's1', explicit: true });
    await api.chat('', 's1', { formSubmission: { form_id: 'ficha_goto', data: { group: 'g' } } });
    expect(cuerpo().form_submission).toEqual({ form_id: 'ficha_goto', data: { group: 'g' } });
  });

  it('sin red el turno queda en cola y se avisa; no se lanza', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await api.chat('hola', 's1');
    expect(r.offline_queued).toBe(true);
    expect(r.text).toContain('Sin conexión');
    expect(api.outboxSize()).toBe(1);
  });

  it('un error del servidor NO se encola: se lanza', async () => {
    fetchMock.mockResolvedValue(respuesta(500, { error: 'boom' }));
    await expect(api.chat('hola', 's1')).rejects.toThrow('boom');
    expect(api.outboxSize()).toBe(0);
  });

  it('al reconectar reenvía en orden; conserva lo que sigue sin red y descarta lo que el servidor rechaza', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await api.chat('uno', 's'); await api.chat('dos', 's'); await api.chat('tres', 's');
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(respuesta(200, {}))                    // uno: enviado
      .mockResolvedValueOnce(respuesta(400, { error: 'inválido' })) // dos: rechazado, se descarta
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));     // tres: sigue sin red
    expect(await api.flushOutbox()).toBe(2);
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).message)).toEqual(['uno', 'dos', 'tres']);
    expect(api.outboxSize()).toBe(1);
  });

  it('con la cola vacía no llama a nada', async () => {
    expect(await api.flushOutbox()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('la sesión de chat se guarda y se lee; un id vacío no pisa la guardada', () => {
    expect(api.loadSessionId()).toBeNull();
    api.saveSessionId('s1');
    api.saveSessionId('');
    expect(api.loadSessionId()).toBe('s1');
  });
});
