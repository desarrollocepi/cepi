/** Evoluciones de la ficha (PAPER §28.4). */
import { describe, it, expect } from 'vitest';
import {
  buildAddEvolutionBatch, buildInitialEvolution, evolutionBlockReason, evolutionInputError,
  isLatestEvolution, recordField, diagnosisText, EVOLUTION_ENTITY_ID,
} from '../src/evolucion.js';

const EP = '12000000-0000-0000-0000-000000000000';
const PA = '11000000-0000-0000-0000-000000000000';

const episodio = {
  fecha: '2026-10-01', medico_id: 'u-primario', examinador_nombre: '', diagnostico: 'Psoriasis', codigo_cie10: 'L40.0',
  tratamiento_resumen: '', plan: 'Clobetasol', observaciones: 'Placas en codos', proximo_control_fecha: '2026-11-01T00:00:00Z',
  proximo_control_motivo: 'Ver respuesta',
};

describe('evolución: agregar', () => {
  it('sin evoluciones previas: inicial con la foto del episodio, la nueva, el episodio vigente y la nota', () => {
    const b = buildAddEvolutionBatch({
      episodeId: 'ep1', patientId: 'p1', ep: episodio, hasEvolutions: false,
      input: { hallazgos: 'Mejoría', diagnostico: 'L40.0 — Psoriasis vulgar', tratamiento: '', proximo_control_fecha: '2026-12-09' },
      userId: 'u-derma', userName: 'Dra. Gaby', today: '2026-11-09',
    });
    expect(b.map((s) => s.role)).toEqual(['initial', 'evolution', 'episode', 'note']);
    expect(b[0].args).toMatchObject({
      entity_id: EVOLUTION_ENTITY_ID,
      data: {
        [`${EP}:episode_id`]: 'ep1', [`${PA}:patient_id`]: 'p1', fecha: '2026-10-01', medico_id: 'u-primario',
        diagnostico: 'L40.0 — Psoriasis', tratamiento: 'Clobetasol', observaciones: 'Placas en codos',
        proximo_control_fecha: '2026-11-01', proximo_control_motivo: 'Ver respuesta', es_inicial: true,
      },
    });
    expect((b[0].args as any).data.atendio_nombre).toBeUndefined();
    expect(b[1].args).toMatchObject({
      data: { fecha: '2026-11-09', medico_id: 'u-derma', hallazgos: 'Mejoría', diagnostico: 'L40.0 — Psoriasis vulgar', es_inicial: false },
    });
    expect((b[1].args as any).data.tratamiento).toBeUndefined();
    // Solo lo que trae: el tratamiento vacío no pisa el del episodio; los hallazgos no van al episodio.
    expect(b[2].args).toEqual({
      id: 'ep1', record_type: 'business',
      data: { diagnostico: 'L40.0 — Psoriasis vulgar', proximo_control_fecha: '2026-12-09' },
    });
    expect(b[3].args.body).toBe('📝 Evolución del 2026-11-09 por Dra. Gaby.');
  });

  it('con evoluciones previas no repite la inicial; solo hallazgos no toca el episodio', () => {
    const b = buildAddEvolutionBatch({
      episodeId: 'ep1', patientId: null, ep: episodio, hasEvolutions: true,
      input: { fecha: '2026-11-05', hallazgos: 'Igual' }, userId: null, today: '2026-11-09',
    });
    expect(b.map((s) => s.role)).toEqual(['evolution', 'note']);
    expect((b[0].args as any).data.fecha).toBe('2026-11-05');
    expect((b[0].args as any).data.medico_id).toBeUndefined();
    expect(b[1].args.body).toBe('📝 Evolución del 2026-11-05 por el médico.');
  });

  it('la inicial de una ficha espejada lleva el nombre del examinador y cae a quien la creó', () => {
    const d = buildInitialEvolution({ episodeId: 'ep2', patientId: null, ep: { fecha: '2026-01-02', examinador_nombre: 'Dr. Espejo' }, createdBy: 'u-espejo' });
    expect(d.data).toMatchObject({ atendio_nombre: 'Dr. Espejo', medico_id: 'u-espejo', fecha: '2026-01-02', es_inicial: true });
  });

  it('validación y bloqueo', () => {
    expect(evolutionInputError({ proximo_control_motivo: 'x' })).toMatch(/al menos/);
    expect(evolutionInputError({ observaciones: '  ' })).toMatch(/al menos/);
    expect(evolutionInputError({ observaciones: 'ok', fecha: '09/11/2026' })).toMatch(/fecha/);
    expect(evolutionInputError({ tratamiento: 'ok', proximo_control_fecha: 'mañana' })).toMatch(/proximo_control_fecha/);
    expect(evolutionInputError({ hallazgos: 'ok', fecha: '2026-11-09' })).toBeNull();
    expect(evolutionBlockReason({ estado: 'alta' })).toBe('Esta ficha está de alta: abre una consulta nueva');
    expect(evolutionBlockReason({ estado: 'cerrado' })).toBeNull();
    expect(evolutionBlockReason(null)).toBe('No se encontró la consulta');
  });
});

describe('evolución: utilidades', () => {
  it('diagnosisText', () => {
    expect(diagnosisText('Psoriasis', 'L40.0')).toBe('L40.0 — Psoriasis');
    expect(diagnosisText('L40.0 — Psoriasis', 'L40.0')).toBe('L40.0 — Psoriasis');
    expect(diagnosisText('', '')).toBeNull();
  });
  it('recordField lee columna, data o relación', () => {
    expect(recordField({ episode_id: 'a' }, 'episode_id')).toBe('a');
    expect(recordField({ data: { episode_id: 'b' } }, 'episode_id')).toBe('b');
    expect(recordField({ data: { [`${EP}:episode_id`]: 'c' } }, 'episode_id')).toBe('c');
    expect(recordField(null, 'x')).toBeNull();
  });
  it('isLatestEvolution: por fecha y, a igual fecha, la creada después', () => {
    const rows = [
      { id: 'a', fecha: '2026-10-01', created_at: '2026-10-01T10:00:00Z' },
      { id: 'b', fecha: '2026-11-01', created_at: '2026-11-01T10:00:00Z' },
      { id: 'c', fecha: '2026-11-01', created_at: '2026-11-01T11:00:00Z' },
    ];
    expect(isLatestEvolution(rows, 'c')).toBe(true);
    expect(isLatestEvolution(rows, 'b')).toBe(false);
    expect(isLatestEvolution(rows, 'a')).toBe(false);
    expect(isLatestEvolution(rows, 'zz')).toBe(false);
  });
});

describe('editar una evolución desde su formulario (PAPER §28.4)', () => {
  it('solo cambia lo que viene; vacío borra; lo vigente va al episodio', async () => {
    const { planEvolutionEdit } = await import('../src/evolucion.js');
    const p: any = planEvolutionEdit({ evolution_id: 'x', tratamiento: '  crema ', proximo_control_fecha: '2026-12-01', proximo_control_motivo: '' });
    expect(p.fields).toEqual({ tratamiento: 'crema', proximo_control_fecha: '2026-12-01', proximo_control_motivo: null });
    expect(p.vigente).toEqual({ tratamiento_resumen: 'crema', proximo_control_fecha: '2026-12-01', proximo_control_motivo: null });
  });

  it('valida fechas, no deja la fecha vacía y pide algo que guardar', async () => {
    const { planEvolutionEdit } = await import('../src/evolucion.js');
    expect(planEvolutionEdit({ fecha: '1/12/2026' })).toEqual({ error: 'fecha debe ser YYYY-MM-DD' });
    expect(planEvolutionEdit({ fecha: '' })).toEqual({ error: 'La fecha de la evolución no puede quedar vacía' });
    expect(planEvolutionEdit({ proximo_control_fecha: 'mañana' })).toEqual({ error: 'proximo_control_fecha debe ser YYYY-MM-DD' });
    expect(planEvolutionEdit({ evolution_id: 'x' })).toEqual({ error: 'No hay nada que guardar' });
  });

  it('una ficha de alta no lleva próximo control, pero sí se corrigen sus datos', async () => {
    const { planEvolutionEdit } = await import('../src/evolucion.js');
    expect('error' in planEvolutionEdit({ proximo_control_fecha: '2026-12-01' }, { discharged: true })).toBe(true);
    expect('fields' in planEvolutionEdit({ diagnostico: 'Nevus' }, { discharged: true })).toBe(true);
  });
});
