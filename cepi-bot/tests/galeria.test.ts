/**
 * Galería de imágenes clínicas (PAPER §24.2.1, D-Aux-22): cómo arma la página.
 *
 * Con un cliente ERP falso (sin red ni BD) se verifica lo que de verdad decide esta
 * capa: qué le pide al ERP (y cuántas veces — el N+1 es el enemigo), cómo traduce la
 * búsqueda a los cinco campos del contrato y cómo mapea cada fila. El alcance por
 * organización no se prueba acá: lo pone TodoERP con el JWT del caller y se verifica
 * en `TodoERP/backend/tests/galeria_imagenes.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  listarGaleria, nombreCompleto, LIMITE_DEFAULT, LIMITE_MAX, TOPE_COINCIDENCIAS,
  CLINICAL_IMAGE_ENTITY_ID, PATIENT_ENTITY_ID, EPISODE_ENTITY_ID,
} from '../src/galeria.js';

/** ERP falso: guarda cada consulta y responde según el `type` pedido. */
function fakeErp(porTipo: Record<string, any[]>, total?: number) {
  const consultas: Array<Record<string, any>> = [];
  return {
    consultas,
    de(type: string) { return consultas.filter(c => c.type === type); },
    async listar(params: Record<string, any>) {
      consultas.push(params);
      const filas = porTipo[String(params.type)] || [];
      // `ids=` → solo esas filas, como hace el backend.
      const soloIds = params.ids ? String(params.ids).split(',') : null;
      const data = soloIds ? filas.filter((f: any) => soloIds.includes(String(f.id))) : filas;
      return { data, total: params.with_total ? (total ?? data.length) : undefined };
    },
  };
}

const imagen = (n: number, patientId: string, episodeId: string, extra: any = {}) => ({
  id: `img-${n}`, attachment_id: `att-${n}`, patient_id: patientId, episode_id: episodeId,
  body_region: 'espalda', privada: false, ...extra,
});
const paciente = (id: string, extra: any = {}) => ({
  id, title: 'Lucía Morán', nombre: 'Lucía', apellidos: 'Morán', cedula: '0912345678', ...extra,
});
const episodio = (id: string, extra: any = {}) => ({
  id, fecha: '2026-05-06', diagnostico: 'Melanoma maligno', codigo_cie10: 'C43.9', ...extra,
});

describe('listarGaleria', () => {
  it('pide la página de imágenes con paginado real y sin ampliar el alcance', async () => {
    const erp = fakeErp({ [CLINICAL_IMAGE_ENTITY_ID]: [] });
    await listarGaleria(erp as any);
    const [consulta] = erp.de(CLINICAL_IMAGE_ENTITY_ID);
    expect(consulta.type).toBe(CLINICAL_IMAGE_ENTITY_ID);
    expect(consulta.limit).toBe(LIMITE_DEFAULT);
    expect(consulta.offset).toBe(0);
    expect(consulta.with_total).toBe(1);
    // Nada de org en los parámetros: eso lo pone el ERP con el JWT del caller.
    expect(Object.keys(consulta).some(k => k.includes('org'))).toBe(false);
  });

  it('no muestra fotos de un paciente (o una consulta) borrado', async () => {
    const erp = fakeErp({ [CLINICAL_IMAGE_ENTITY_ID]: [] });
    await listarGaleria(erp as any);
    const [consulta] = erp.de(CLINICAL_IMAGE_ENTITY_ID);
    expect(consulta['filter[patient_id][active]']).toBe(1);
    expect(consulta['filter[episode_id][active]']).toBe(1);
  });

  it('arma cada fila con lo que hace falta para reconocer el caso sin abrirlo', async () => {
    const erp = fakeErp({
      [CLINICAL_IMAGE_ENTITY_ID]: [imagen(1, 'p-1', 'e-1', { privada: true, body_region: 'brazo' })],
      [PATIENT_ENTITY_ID]: [paciente('p-1')],
      [EPISODE_ENTITY_ID]: [episodio('e-1')],
    });
    const { data, total } = await listarGaleria(erp as any);
    expect(total).toBe(1);
    expect(data[0]).toEqual({
      id: 'img-1', attachment_id: 'att-1',
      patient_id: 'p-1', paciente: 'Lucía Morán', cedula: '0912345678',
      episode_id: 'e-1', fecha: '2026-05-06',
      diagnostico: 'Melanoma maligno', codigo_cie10: 'C43.9',
      body_region: 'brazo', privada: true,
    });
  });

  it('resuelve paciente y consulta en UNA consulta cada uno, no una por foto', async () => {
    const imagenes = Array.from({ length: 60 }, (_, i) => imagen(i, `p-${i % 20}`, `e-${i % 30}`));
    const erp = fakeErp({
      [CLINICAL_IMAGE_ENTITY_ID]: imagenes,
      [PATIENT_ENTITY_ID]: Array.from({ length: 20 }, (_, i) => paciente(`p-${i}`)),
      [EPISODE_ENTITY_ID]: Array.from({ length: 30 }, (_, i) => episodio(`e-${i}`)),
    });
    const { data } = await listarGaleria(erp as any);
    expect(data).toHaveLength(60);
    expect(erp.consultas).toHaveLength(3);                    // imágenes + pacientes + episodios
    expect(erp.de(PATIENT_ENTITY_ID)[0].ids.split(',')).toHaveLength(20);   // ids únicos, no 60
    expect(erp.de(EPISODE_ENTITY_ID)[0].ids.split(',')).toHaveLength(30);
    expect(data.every(d => d.paciente === 'Lucía Morán')).toBe(true);
  });

  it('una foto cuyo caso no se pudo resolver sale igual, sin inventar datos', async () => {
    const erp = fakeErp({
      [CLINICAL_IMAGE_ENTITY_ID]: [imagen(1, 'p-1', 'e-1')],
      [PATIENT_ENTITY_ID]: [], [EPISODE_ENTITY_ID]: [],
    });
    const { data } = await listarGaleria(erp as any);
    expect(data[0].paciente).toBeNull();
    expect(data[0].fecha).toBeNull();
    expect(data[0].id).toBe('img-1');
  });

  describe('imágenes de un paciente', () => {
    it('filtra por ese paciente', async () => {
      const erp = fakeErp({ [CLINICAL_IMAGE_ENTITY_ID]: [] });
      await listarGaleria(erp as any, { patientId: 'p-9' });
      expect(erp.de(CLINICAL_IMAGE_ENTITY_ID)[0]['filter[patient_id][eq]']).toBe('p-9');
    });
  });

  describe('buscador', () => {
    it('busca al paciente por nombre, apellidos, título y cédula', async () => {
      const erp = fakeErp({ [PATIENT_ENTITY_ID]: [], [EPISODE_ENTITY_ID]: [] });
      await listarGaleria(erp as any, { q: 'Morán' });
      const consulta = erp.de(PATIENT_ENTITY_ID)[0];
      expect(consulta.q).toBe('Morán');
      expect(String(consulta.q_fields).split(',').sort())
        .toEqual(['apellidos', 'cedula', 'nombre', 'title']);
      expect(consulta.limit).toBe(TOPE_COINCIDENCIAS);
    });

    it('y a la consulta por diagnóstico, CIE-10 y fecha', async () => {
      const erp = fakeErp({ [PATIENT_ENTITY_ID]: [], [EPISODE_ENTITY_ID]: [] });
      await listarGaleria(erp as any, { q: 'C43.9' });
      const consulta = erp.de(EPISODE_ENTITY_ID)[0];
      expect(String(consulta.q_fields).split(',').sort())
        .toEqual(['codigo_cie10', 'diagnostico', 'fecha']);
    });

    it('la imagen entra si es del paciente O de la consulta que matchean', async () => {
      const erp = fakeErp({
        [PATIENT_ENTITY_ID]: [paciente('p-1')],
        [EPISODE_ENTITY_ID]: [episodio('e-7'), episodio('e-8')],
        [CLINICAL_IMAGE_ENTITY_ID]: [imagen(1, 'p-1', 'e-7')],
      });
      await listarGaleria(erp as any, { q: 'melanoma' });
      const consulta = erp.de(CLINICAL_IMAGE_ENTITY_ID)[0];
      expect(consulta['filter_or[patient_id][in]']).toBe('p-1');
      expect(consulta['filter_or[episode_id][in]']).toBe('e-7,e-8');
    });

    it('si no matchea ni un paciente ni una consulta, ni pregunta por las imágenes', async () => {
      const erp = fakeErp({ [PATIENT_ENTITY_ID]: [], [EPISODE_ENTITY_ID]: [] });
      const r = await listarGaleria(erp as any, { q: 'nadaquever' });
      expect(r).toEqual({ data: [], total: 0 });
      expect(erp.de(CLINICAL_IMAGE_ENTITY_ID)).toHaveLength(0);
    });

    it('un texto en blanco no es una búsqueda', async () => {
      const erp = fakeErp({ [CLINICAL_IMAGE_ENTITY_ID]: [] });
      await listarGaleria(erp as any, { q: '   ' });
      expect(erp.de(PATIENT_ENTITY_ID)).toHaveLength(0);
      expect(erp.de(CLINICAL_IMAGE_ENTITY_ID)[0]['filter_or[patient_id][in]']).toBeUndefined();
    });

    it('busca dentro de un paciente cuando vienen los dos', async () => {
      const erp = fakeErp({
        [PATIENT_ENTITY_ID]: [paciente('p-1')], [EPISODE_ENTITY_ID]: [],
        [CLINICAL_IMAGE_ENTITY_ID]: [],
      });
      await listarGaleria(erp as any, { q: 'Lucía', patientId: 'p-1' });
      const consulta = erp.de(CLINICAL_IMAGE_ENTITY_ID)[0];
      expect(consulta['filter[patient_id][eq]']).toBe('p-1');
      expect(consulta['filter_or[patient_id][in]']).toBe('p-1');
    });
  });

  describe('paginado', () => {
    it('respeta limit y offset, y el total lo pone el ERP', async () => {
      const erp = fakeErp({
        [CLINICAL_IMAGE_ENTITY_ID]: [imagen(1, 'p-1', 'e-1')],
        [PATIENT_ENTITY_ID]: [paciente('p-1')], [EPISODE_ENTITY_ID]: [episodio('e-1')],
      }, 138);
      const r = await listarGaleria(erp as any, { limit: 24, offset: 48 });
      expect(erp.de(CLINICAL_IMAGE_ENTITY_ID)[0].limit).toBe(24);
      expect(erp.de(CLINICAL_IMAGE_ENTITY_ID)[0].offset).toBe(48);
      expect(r.total).toBe(138);
    });

    it('un limit disparatado se acota al tope, y uno negativo no rompe', async () => {
      const erp = fakeErp({ [CLINICAL_IMAGE_ENTITY_ID]: [] });
      await listarGaleria(erp as any, { limit: 5000, offset: -10 });
      expect(erp.de(CLINICAL_IMAGE_ENTITY_ID)[0].limit).toBe(LIMITE_MAX);
      expect(erp.de(CLINICAL_IMAGE_ENTITY_ID)[0].offset).toBe(0);
    });
  });
});

describe('nombreCompleto', () => {
  it('junta nombre y apellidos', () => {
    expect(nombreCompleto('Lucía', 'Morán')).toBe('Lucía Morán');
    expect(nombreCompleto('Lucía', null)).toBe('Lucía');
    expect(nombreCompleto(null, null)).toBeNull();
  });

  it('con PII redactada no repite la marca dos veces', () => {
    // Un rol sin `pii:read:patient` recibe <REDACTED> en los dos campos.
    expect(nombreCompleto('<REDACTED>', '<REDACTED>')).toBe('<REDACTED>');
  });
});
