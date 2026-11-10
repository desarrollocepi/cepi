/**
 * Celular obligatorio y email opcional en el alta de paciente (PAPER §36.1).
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/sessionStore.js', async (orig) => ({ ...(await orig() as any), saveSession: async () => {} }));
import { handleV1Flow, parseNewPatientCommand, PATIENT_NEW_FORM } from '../src/flowV1.js';
import { emptySession } from '../src/sessionStore.js';
import { isValidEmail, normalizeMobile } from '../src/contacto.js';
import { cuerpoDeEnvio, puedeSaltar } from '../src/canalWalk.js';

const fakeMcp = () => ({ async call() { return { ok: true, data: [] }; } }) as any;
const sesion = () => {
  const s: any = { id: 'sess-1', ...emptySession('u1') };
  s.extracted_slots = { mode: 'patient' };
  s.active_patient_id = null;
  return s;
};

describe('normalizeMobile', () => {
  it('acepta celulares de Ecuador e internacionales', () => {
    expect(normalizeMobile('0991234567')).toBe('0991234567');
    expect(normalizeMobile('099-123-4567')).toBe('0991234567');
    expect(normalizeMobile('+593 99 123 4567')).toBe('0991234567');
    expect(normalizeMobile('593991234567')).toBe('0991234567');
    expect(normalizeMobile('+1 (415) 555-0100')).toBe('+14155550100');
  });
  it('rechaza lo que no es un celular', () => {
    for (const x of ['', '02 234 5678', '12345', 'abc', '0891234567', '+593 2 234 5678', null]) {
      expect(normalizeMobile(x as any)).toBeNull();
    }
  });
  it('isValidEmail', () => {
    expect(isValidEmail('a@b.ec')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
  });
});

describe('formulario de alta', () => {
  it('pide celular obligatorio y email opcional', () => {
    const f = Object.fromEntries(PATIENT_NEW_FORM.fields.map((x) => [x.key, x.required]));
    expect(f).toEqual({ cedula: true, nombre: true, apellidos: true, telefono: true, email: false });
  });
  it('el comando admite el formato viejo de tres partes y el nuevo de cinco', () => {
    expect(parseNewPatientCommand('/nuevo-paciente 1 || Juan || Pérez')).toEqual(
      { cedula: '1', nombre: 'Juan', apellidos: 'Pérez', telefono: '', email: '' });
    expect(parseNewPatientCommand('/nuevo-paciente 1 || Juan || Pérez || 0991234567 || ')).toEqual(
      { cedula: '1', nombre: 'Juan', apellidos: 'Pérez', telefono: '0991234567', email: '' });
  });
  it('en Telegram/WhatsApp solo el email tiene «Saltar», y saltarlo deja el email vacío', () => {
    const w: any = { form: PATIENT_NEW_FORM, idx: 3, answers: { cedula: '1', nombre: 'Juan', apellidos: 'Pérez', telefono: '0991234567' } };
    expect(puedeSaltar(w)).toBe(false);
    w.idx = 4;
    expect(puedeSaltar(w)).toBe(true);
    expect(cuerpoDeEnvio(w)).toEqual({ message: '/nuevo-paciente 1 || Juan || Pérez || 0991234567 || ' });
  });
});

describe('/nuevo-paciente', () => {
  it('sin celular no crea y vuelve a pedir el formulario', async () => {
    const s = sesion();
    const r: any = await handleV1Flow({ session: s, message: '/nuevo-paciente 1712345678 || Juan || Pérez', mcp: fakeMcp() });
    expect(r.text).toContain('celular son obligatorios');
    expect(r.form.id).toBe('patient_new');
    expect(s.pending_action).toBeFalsy();
  });

  it('un celular inválido no se prellena (el canal lo vuelve a preguntar)', async () => {
    const s = sesion();
    const r: any = await handleV1Flow({ session: s, message: '/nuevo-paciente 1712345678 || Juan || Pérez || 12345 || ', mcp: fakeMcp() });
    expect(r.text).toContain('no es válido');
    expect(r.form.values).toEqual({ cedula: '1712345678', nombre: 'Juan', apellidos: 'Pérez' });
    expect(s.pending_action).toBeFalsy();
  });

  it('un email inválido se rechaza', async () => {
    const s = sesion();
    const r: any = await handleV1Flow({ session: s, message: '/nuevo-paciente 1712345678 || Juan || Pérez || 0991234567 || juan@', mcp: fakeMcp() });
    expect(r.text).toContain('email «juan@» no es válido');
    expect(s.pending_action).toBeFalsy();
  });

  it('con celular y email crea el paciente con los dos', async () => {
    const s = sesion();
    const r: any = await handleV1Flow({ session: s, message: '/nuevo-paciente 1712345678 || Juan || Pérez || +593 99 123 4567 || juan@correo.ec', mcp: fakeMcp() });
    expect(r.pending_action_set).toBe(true);
    expect(s.pending_action.args.data).toEqual({ cedula: '1712345678', nombre: 'Juan', apellidos: 'Pérez', telefono: '0991234567', email: 'juan@correo.ec' });
    expect(r.text).toContain('Celular: 0991234567');
  });

  it('sin email lo crea sin email', async () => {
    const s = sesion();
    await handleV1Flow({ session: s, message: '/nuevo-paciente 1712345678 || Juan || Pérez || 0991234567 || ', mcp: fakeMcp() });
    expect(s.pending_action.args.data).toEqual({ cedula: '1712345678', nombre: 'Juan', apellidos: 'Pérez', telefono: '0991234567' });
  });
});
