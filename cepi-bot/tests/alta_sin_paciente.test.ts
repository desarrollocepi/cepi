/**
 * Entrar al alta o a la búsqueda de paciente desde el modo `general`.
 *
 * Regresión: un canal sin pantalla de bienvenida (WhatsApp) cae en `general`
 * con el primer mensaje libre. Desde ahí «nuevo» no abría el alta: iba al LLM,
 * que entrevistó al médico durante doce turnos sin guardar nada.
 */
import { describe, it, expect } from 'vitest';
import { handleV1Flow } from '../src/flowV1.js';
import { emptySession } from '../src/sessionStore.js';

function fakeMcp() {
  return {
    async call(name: string, args: any) {
      if (name === 'entities.update') return { ok: true, data: { id: args.id } };
      return { ok: true, data: [] };
    },
  } as any;
}

const sesion = (mode?: string, paciente: string | null = null) => {
  const s: any = { id: 'sess-1', ...emptySession('u1') };
  if (mode) s.extracted_slots = { mode };
  s.active_patient_id = paciente;
  return s;
};

describe('alta y búsqueda sin paciente activo', () => {
  for (const mode of [undefined, 'general']) {
    for (const msg of ['nuevo', 'Nuevo', 'nuevo paciente', '/nuevo paciente', 'crear paciente']) {
      it(`«${msg}» en modo ${mode ?? 'unset'} abre el formulario de alta`, async () => {
        const s = sesion(mode);
        const r = await handleV1Flow({ session: s, message: msg, mcp: fakeMcp() });
        expect(r?.form?.id).toBe('patient_new');
        expect((s.extracted_slots as any).mode).toBe('patient');
      });
    }
    for (const msg of ['paciente', 'buscar', 'buscar paciente', 'atención']) {
      it(`«${msg}» en modo ${mode ?? 'unset'} abre la búsqueda`, async () => {
        const r = await handleV1Flow({ session: sesion(mode), message: msg, mcp: fakeMcp() });
        expect(r?.form?.id).toBe('patient_search');
      });
    }
  }

  it('con paciente activo en modo general, «nuevo» NO cambia de paciente', async () => {
    const r = await handleV1Flow({ session: sesion('general', 'pat-1'), message: 'nuevo', mcp: fakeMcp() });
    expect(r?.form?.id).not.toBe('patient_new');
  });
});
