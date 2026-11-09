/**
 * `guardarGrupoFicha` — el camino de edición del portal de casos (PAPER §22).
 *
 * Guarda los mismos grupos que el chat pero sin sesión, así que lo que se protege es
 * que no diverja: mismo enrutado paciente/episodio, mismas coerciones y derivados.
 * Y que un payload no pueda escribir campos que el grupo no declara.
 */
import { describe, it, expect } from 'vitest';
import { guardarGrupoFicha } from '../src/flowV1.js';

function fakeMcp(datosActuales: any = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  const mcp: any = {
    calls,
    get jwt() { return 't'; }, get apiKey() { return ''; }, get apiUrl() { return ''; },
    async connect() {}, async close() {},
    async call(name: string, args: any) {
      calls.push({ name, args });
      if (name === 'entities.update') return { ok: true, data: { id: args.id } };
      if (name === 'entities.get') return { ok: true, data: { id: args.id, data: datosActuales } };
      if (name === 'entities.list') return { ok: true, data: [] };
      return { ok: false, error: `unknown ${name}` };
    },
  };
  return mcp;
}
const updates = (mcp: any) => mcp.calls.filter((c: any) => c.name === 'entities.update');

const IDS = { patientId: 'p-1', episodeId: 'e-1' };

describe('guardarGrupoFicha', () => {
  it('un campo de §1 se escribe en el PACIENTE', async () => {
    const mcp = fakeMcp();
    const r = await guardarGrupoFicha(mcp, { groupId: 'g_1_4', data: { etnia: 'mestiza' }, ...IDS });
    expect(r.target).toBe('patient');
    expect(r.targetId).toBe('p-1');
    expect(updates(mcp)[0].args.data).toMatchObject({ etnia: 'mestiza' });
  });

  it('un campo de §3 se escribe en el EPISODIO', async () => {
    const mcp = fakeMcp();
    const r = await guardarGrupoFicha(mcp, { groupId: 'g_3_2', data: { tiempo_evolucion: '4 años' }, ...IDS });
    expect(r.target).toBe('episode');
    expect(r.targetId).toBe('e-1');
  });

  it('descarta las claves que no pertenecen al grupo', async () => {
    // Sin esto, un payload podría escribir cualquier campo de la entidad desde un
    // formulario que no lo declara.
    const mcp = fakeMcp();
    await guardarGrupoFicha(mcp, { groupId: 'g_1_4', data: { etnia: 'mestiza', cedula: 'INYECTADA' }, ...IDS });
    const escrito = updates(mcp)[0].args.data;
    expect(escrito.etnia).toBe('mestiza');
    expect(escrito).not.toHaveProperty('cedula');
  });

  it('falla si el payload no trae ningún campo del grupo', async () => {
    await expect(guardarGrupoFicha(fakeMcp(), { groupId: 'g_1_4', data: { cedula: 'X' }, ...IDS }))
      .rejects.toThrow(/ningún campo/i);
  });

  it('rechaza los grupos de imagen, que no escriben campos', async () => {
    await expect(guardarGrupoFicha(fakeMcp(), { groupId: 'g_4_7', data: { imagenes_lesion: 'a' }, ...IDS }))
      .rejects.toThrow(/subiendo im/i);
  });

  it('exige el id de la entidad que corresponde al grupo', async () => {
    await expect(guardarGrupoFicha(fakeMcp(), { groupId: 'g_1_4', data: { etnia: 'mestiza' }, episodeId: 'e-1' }))
      .rejects.toThrow(/patient_id/);
    await expect(guardarGrupoFicha(fakeMcp(), { groupId: 'g_3_2', data: { tiempo_evolucion: 'x' }, patientId: 'p-1' }))
      .rejects.toThrow(/episode_id/);
  });

  it('guarda la prioridad clínica (reemplaza al BLINK, PAPER §34)', async () => {
    const mcp = fakeMcp();
    await guardarGrupoFicha(mcp, { groupId: 'g_prioridad', data: { prioridad: 'Urgente' }, ...IDS });
    expect(updates(mcp)[0].args.data.prioridad).toBe('Urgente');
  });

  it('gravedad_total se re-deriva con lo que ya hay en el episodio', async () => {
    // Los formularios son atómicos: un envío nunca trae las tres gravedades.
    const mcp = fakeMcp({ gravedad_extension: 2, gravedad_intensidad: 1 });
    await guardarGrupoFicha(mcp, { groupId: 'g_4_4', data: { gravedad_funcionalidad: '3' }, ...IDS });
    expect(updates(mcp)[0].args.data.gravedad_total).toBe(6);
  });

  it('propaga el fallo de escritura en vez de reportar éxito', async () => {
    const mcp = fakeMcp();
    mcp.call = async (name: string) => (name === 'entities.update' ? { ok: false, error: 'denegado' } : { ok: true, data: { data: {} } });
    await expect(guardarGrupoFicha(mcp, { groupId: 'g_1_4', data: { etnia: 'mestiza' }, ...IDS }))
      .rejects.toThrow(/denegado/);
  });
});
