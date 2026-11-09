/** Próximos controles (PAPER §33). */
import { describe, it, expect } from 'vitest';
import { listarControles, ultimaConsultaPorPaciente, estadoDe } from '../src/controles.js';

const EP = '12000000-0000-0000-0000-000000000000';
const PAT = '11000000-0000-0000-0000-000000000000';
const USR = 'e1000000-0000-0000-0000-000000000000';

function fakeErp(tablas: Record<string, any[]>) {
  const llamadas: any[] = [];
  return {
    llamadas,
    async listar(p: Record<string, any>) {
      llamadas.push(p);
      let filas = [...(tablas[p.type] || [])];
      if (p.ids) { const s = new Set(String(p.ids).split(',')); filas = filas.filter(f => s.has(f.id)); }
      if (p['filter[patient_id][in]']) { const s = new Set(String(p['filter[patient_id][in]']).split(',')); filas = filas.filter(f => s.has(f.patient_id)); }
      if (p['filter[proximo_control_fecha][gte]']) {
        filas = filas.filter(f => f.proximo_control_fecha && f.proximo_control_fecha >= p['filter[proximo_control_fecha][gte]']
          && f.proximo_control_fecha <= p['filter[proximo_control_fecha][lte]']);
      }
      return { data: filas };
    },
  };
}

const episodios = [
  // Ana: su última consulta tiene control → se lista.
  { id: 'e1', patient_id: 'pA', fecha: '2026-10-01', proximo_control_fecha: '2026-11-20', proximo_control_motivo: 'Control de nevus', plan: 'Dermatoscopía', diagnostico: 'Nevus', medico_id: 'u1', created_at: '2026-10-01T10:00:00Z' },
  // Beto: tenía control, pero volvió después (consulta nueva sin control) → no se lista.
  { id: 'e2', patient_id: 'pB', fecha: '2026-09-01', proximo_control_fecha: '2026-11-15', proximo_control_motivo: 'viejo', created_at: '2026-09-01T10:00:00Z' },
  { id: 'e3', patient_id: 'pB', fecha: '2026-11-05', created_at: '2026-11-05T10:00:00Z' },
  // Caro: control atrasado.
  { id: 'e4', patient_id: 'pC', fecha: '2026-08-01', proximo_control_fecha: '2026-11-01', proximo_control_motivo: 'Retirar puntos', created_by: 'u2', created_at: '2026-08-01T10:00:00Z' },
  // Fuera del rango.
  { id: 'e5', patient_id: 'pD', fecha: '2026-08-01', proximo_control_fecha: '2027-06-01', created_at: '2026-08-01T10:00:00Z' },
];
const pacientes = [
  { id: 'pA', nombre: 'Ana', apellidos: 'Pérez', cedula: '0102' },
  { id: 'pB', nombre: 'Beto', apellidos: 'Ruiz' },
  { id: 'pC', nombre: 'Caro', apellidos: 'Lema' },
];
const usuarios = [{ id: 'u1', nombre: 'Dra. Gaby' }, { id: 'u2', nombre: 'Dr. Luis' }];

describe('controles', () => {
  it('lista el control de la consulta más reciente de cada paciente, con qué hacer', async () => {
    const erp = fakeErp({ [EP]: episodios, [PAT]: pacientes, [USR]: usuarios });
    const r = await listarControles(erp, { hoy: '2026-11-09' });
    expect(r.from).toBe('2026-10-10');
    expect(r.to).toBe('2027-02-07');
    expect(r.data.map(c => c.episode_id)).toEqual(['e4', 'e1']);
    expect(r.data[0]).toMatchObject({ paciente: 'Caro Lema', motivo: 'Retirar puntos', medico: 'Dr. Luis', estado_control: 'atrasado' });
    expect(r.data[1]).toMatchObject({
      paciente: 'Ana Pérez', cedula: '0102', fecha_control: '2026-11-20', motivo: 'Control de nevus',
      plan: 'Dermatoscopía', diagnostico: 'Nevus', fecha_consulta: '2026-10-01', medico: 'Dra. Gaby', estado_control: 'proximo',
    });
    // Sin N+1: rango, consultas de esos pacientes, pacientes y médicos.
    expect(erp.llamadas).toHaveLength(4);
  });

  it('sin controles en el rango no pide nada más', async () => {
    const erp = fakeErp({ [EP]: [] });
    const r = await listarControles(erp, { hoy: '2026-11-09' });
    expect(r.data).toEqual([]);
    expect(erp.llamadas).toHaveLength(1);
  });

  it('respeta from/to válidos e ignora los inválidos', async () => {
    const erp = fakeErp({ [EP]: episodios, [PAT]: pacientes, [USR]: usuarios });
    const r = await listarControles(erp, { hoy: '2026-11-09', from: '2026-11-10', to: 'mañana' });
    expect(r.from).toBe('2026-11-10');
    expect(r.to).toBe('2027-02-07');
    expect(r.data.map(c => c.episode_id)).toEqual(['e1']);
  });

  it('estado y última consulta', () => {
    expect(estadoDe('2026-11-08', '2026-11-09')).toBe('atrasado');
    expect(estadoDe('2026-11-09', '2026-11-09')).toBe('hoy');
    expect(estadoDe('2026-11-10', '2026-11-09')).toBe('proximo');
    const u = ultimaConsultaPorPaciente([
      { id: 'a', patient_id: 'p', fecha: '2026-10-01', created_at: '2026-10-01T09:00:00Z' },
      { id: 'b', patient_id: 'p', fecha: '2026-10-01', created_at: '2026-10-01T11:00:00Z' },
    ]);
    expect(u.get('p')).toBe('b');
  });
});

describe('controles sin permiso para leer usuarios', () => {
  it('usa examinador_nombre y no falla', async () => {
    const erp = fakeErp({ [EP]: [{ ...episodios[0], examinador_nombre: 'Dra. G.' }], [PAT]: pacientes });
    const orig = erp.listar.bind(erp);
    erp.listar = async (p: any) => {
      if (p.type === USR) throw Object.assign(new Error('Forbidden'), { status: 403 });
      return orig(p);
    };
    const r = await listarControles(erp, { hoy: '2026-11-09' });
    expect(r.data[0].medico).toBe('Dra. G.');
  });
});
