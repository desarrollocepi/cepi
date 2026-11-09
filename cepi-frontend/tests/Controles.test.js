import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('../src/api.js', () => ({ listarControles: vi.fn() }));
import * as api from '../src/api.js';
import Controles from '../src/components/Controles.vue';

const fila = (o) => ({
  episode_id: o.id, patient_id: `p-${o.id}`, paciente: o.paciente, cedula: o.cedula || null,
  fecha_control: o.fecha, motivo: 'motivo' in o ? o.motivo : 'Control', plan: o.plan || null, diagnostico: o.dx || null,
  fecha_consulta: '2026-10-01', medico: o.medico || null, estado_control: o.estado,
});
const datos = [
  fila({ id: 'e1', paciente: 'Caro Lema', fecha: '2026-11-01', estado: 'atrasado', motivo: 'Retirar puntos' }),
  fila({ id: 'e2', paciente: 'Ana Pérez', cedula: '0102', fecha: '2026-11-11', estado: 'proximo', motivo: 'Control de nevus', plan: 'Dermatoscopía', dx: 'Nevus', medico: 'Dra. Gaby' }),
  fila({ id: 'e3', paciente: 'Beto Ruiz', fecha: '2026-11-17', estado: 'proximo', motivo: null }),
  fila({ id: 'e4', paciente: 'Dani Sosa', fecha: '2026-12-02', estado: 'proximo' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  api.listarControles.mockResolvedValue({ ok: true, today: '2026-11-09', data: datos });
});

describe('Controles (PAPER §33)', () => {
  it('atrasados arriba y luego por semana, con qué hacer', async () => {
    const w = mount(Controles);
    await flushPromises();
    const titulos = w.findAll('.ctl-titulo').map((t) => t.text().replace(/\s+\d+$/, ''));
    expect(titulos).toEqual(['Atrasados', 'Esta semana', 'Próxima semana', 'Semana del 30 nov 2026']);
    const ana = w.find('[data-grupo="2026-11-09"] .ctl-fila');
    expect(ana.text()).toContain('Ana Pérez · 0102');
    expect(ana.text()).toContain('Control de nevus');
    expect(ana.text()).toContain('Plan: Dermatoscopía');
    expect(ana.text()).toContain('indicó Dra. Gaby');
    expect(ana.text()).toContain('miércoles');
    expect(w.find('[data-grupo="atrasados"]').text()).toContain('Atrasado');
    expect(w.find('[data-grupo="2026-11-16"]').text()).toContain('Sin indicación de qué hacer');
  });

  it('busca por paciente o cédula', async () => {
    const w = mount(Controles);
    await flushPromises();
    await w.find('.ctl-buscar').setValue('0102');
    expect(w.findAll('.ctl-fila')).toHaveLength(1);
    await w.find('.ctl-buscar').setValue('zzz');
    expect(w.text()).toContain('Ningún control para «zzz»');
  });

  it('tocar una fila abre la ficha del paciente', async () => {
    const w = mount(Controles);
    await flushPromises();
    await w.find('[data-grupo="2026-11-09"] .ctl-fila').trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'chat-paciente', params: { patientId: 'p-e2', seccion: 'ficha' } });
  });

  it('vacío y error lo dicen', async () => {
    api.listarControles.mockResolvedValueOnce({ ok: true, today: '2026-11-09', data: [] });
    let w = mount(Controles);
    await flushPromises();
    expect(w.text()).toContain('No hay controles agendados en los próximos 90 días');
    api.listarControles.mockRejectedValueOnce(new Error('HTTP 500'));
    w = mount(Controles);
    await flushPromises();
    expect(w.text()).toContain('No se pudieron cargar los controles: HTTP 500');
  });
});
