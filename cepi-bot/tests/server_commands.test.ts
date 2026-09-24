/**
 * Server-side command parsing tests. We don't spin up the actual MCP / DB
 * here; we just regex-match the message and assert what the server *would*
 * stage. Pure unit tests of the dispatch logic.
 *
 * The full HTTP integration test (boot backend + bot + supertest) lives
 * in TodoERP/backend/tests/mcp_generality.test.ts.
 */
import { describe, it, expect } from 'vitest';

// The server's command dispatchers are inline regexes; reproducing them
// here keeps the contract explicit and lets us refactor safely.
const RE = {
  setPatient:    /^\/?\s*activar\s+paciente\s+([0-9a-f-]{36})\s*$/i,
  setEpisode:    /^\/?\s*activar\s+episodio\s+([0-9a-f-]{36})\s*$/i,
  clrPatient:    /^\/?\s*(salir|cerrar|olvidar)\s+paciente\s*$/i,
  clrEpisode:    /^\/?\s*(salir|cerrar|olvidar)\s+episodio\s*$/i,
  newEpisode:    /^\/?\s*nuevo\s+episodio\b\s*(.*)$/i,
  closeEpisode:  /^\/?\s*cerrar\s+episodio\b\s*([0-9]{4}-[0-9]{2}-[0-9]{2})?\s*(.*)$/i,
  diagnostico:   /^\/?\s*diagn[óo]stico\s+([A-Z][0-9]{1,2}(?:\.[0-9]{1,2})?)\s+(.+)$/i,
  escalar:       /^\/?\s*escalar\s+a\s+([0-9a-f-]{36})\b\s*(.*)$/i,
  signs:         /^\/?\s*signs?\s+(.+)$/i,
  exportar:      /^\s*\/?\s*exportar\s*(anonimizado)?\s*$/i,
  attachment:    /\[adjunto:\s*([^·]+)·\s*([0-9a-f-]{36})\s*\]/i,
  imageResults:  /^\/?\s*mostrar\s+resultados?\s+(?:de\s+(?:las?\s+)?)?im[áa]gen(?:es)?\b\s*(.*)$/i,
  confirmYes:    /^\s*(s[ií]|si|confirmar|ok|adelante|yes)\s*$/i,
  confirmNo:     /^\s*(no|cancelar|cancel|abort)\s*$/i,
  // Telemedicina
  sendCase:      /^\/?\s*enviar\s+caso\b\s*(.*)$/i,
  inbox:         /^\/?\s*(entrantes|turno|bandeja(?:\s+de)?\s+turno)\s*$/i,
  claim:         /^\/?\s*reclamar\b\s*([0-9a-f-]{36})?\s*$/i,
  derive:        /^\/?\s*derivar\s+a\s+(.+)$/is,
  answer:        /^\/?\s*responder\s+([\s\S]+)$/i,
};

const VALID_UUID = '11000000-0000-0000-1000-000000000001';

describe('command regexes', () => {
  it('matches "activar paciente <uuid>"', () => {
    expect(`activar paciente ${VALID_UUID}`.match(RE.setPatient)?.[1]).toBe(VALID_UUID);
    expect('/activar paciente '.match(RE.setPatient)).toBeNull();
  });

  it('matches "salir paciente" with all 3 verbs', () => {
    for (const v of ['salir', 'cerrar', 'olvidar']) {
      expect(`${v} paciente`.match(RE.clrPatient)).not.toBeNull();
    }
  });

  it('matches "nuevo episodio <motivo>" and captures motivo', () => {
    expect('nuevo episodio control de nevus'.match(RE.newEpisode)?.[1]).toBe('control de nevus');
    expect('nuevo episodio'.match(RE.newEpisode)?.[1]).toBe('');
  });

  it('matches "cerrar episodio YYYY-MM-DD motivo"', () => {
    const m = 'cerrar episodio 2026-07-01 control evolución'.match(RE.closeEpisode);
    expect(m?.[1]).toBe('2026-07-01');
    expect(m?.[2]).toBe('control evolución');
  });

  it('matches /diagnostico C43.9 …', () => {
    const m = 'diagnostico C43.9 melanoma maligno'.match(RE.diagnostico);
    expect(m?.[1]).toBe('C43.9');
    expect(m?.[2]).toBe('melanoma maligno');
  });

  it('matches /escalar a <uuid> <razón>', () => {
    const m = `escalar a ${VALID_UUID} sospecha alta`.match(RE.escalar);
    expect(m?.[1]).toBe(VALID_UUID);
    expect(m?.[2]).toBe('sospecha alta');
  });

  it('matches /escalar a <uuid> sin razón (motivo opcional)', () => {
    const m = `escalar a ${VALID_UUID} `.match(RE.escalar);
    expect(m?.[1]).toBe(VALID_UUID);
    expect((m?.[2] || '').trim()).toBe('');
  });

  it('matches signs k=v k=v', () => {
    const m = 'signs PA=120/80 FC=70'.match(RE.signs);
    expect(m?.[1]).toBe('PA=120/80 FC=70');
  });

  it('matches "exportar" and "exportar anonimizado"', () => {
    expect('exportar'.match(RE.exportar)).not.toBeNull();
    expect('exportar anonimizado'.match(RE.exportar)?.[1]).toBe('anonimizado');
  });

  it('matches the attachment marker emitted by the uploader', () => {
    const m = `[adjunto: foto.jpg · ${VALID_UUID}]`.match(RE.attachment);
    expect(m?.[1].trim()).toBe('foto.jpg');
    expect(m?.[2]).toBe(VALID_UUID);
  });

  it('matches "mostrar resultados imagen" and its variants', () => {
    for (const cmd of [
      'mostrar resultados imagen',
      'mostrar resultados imágenes',
      'mostrar resultado de la imagen',
      'mostrar resultados de imagenes',
      '/mostrar resultados imagen',
      // scoped to specific clinical_image ids (the §4.7 auto-flow form)
      'mostrar resultados imagen 22d9574f-82d7-4936-8105-31674474f47c',
    ]) {
      expect(cmd.match(RE.imageResults), cmd).not.toBeNull();
    }
    // the captured trailing group carries the optional ids
    const scoped = 'mostrar resultados imagen 22d9574f-82d7-4936-8105-31674474f47c'
      .match(RE.imageResults);
    expect(scoped?.[1]?.trim()).toBe('22d9574f-82d7-4936-8105-31674474f47c');
    expect('mostrar imagen'.match(RE.imageResults)).toBeNull();
    expect('mostrar resultados'.match(RE.imageResults)).toBeNull();
  });

  it('matches confirmYes / confirmNo vocabulary', () => {
    for (const yes of ['sí', 'si', 'ok', 'confirmar', 'adelante', 'yes']) {
      expect(yes.match(RE.confirmYes)).not.toBeNull();
    }
    for (const no of ['no', 'cancelar', 'abort', 'cancel']) {
      expect(no.match(RE.confirmNo)).not.toBeNull();
    }
  });
});

describe('telemedicine command regexes', () => {
  it('matches "enviar caso" with and without motivo', () => {
    expect('enviar caso'.match(RE.sendCase)?.[1]).toBe('');
    expect('enviar caso lesión pigmentada en espalda'.match(RE.sendCase)?.[1])
      .toBe('lesión pigmentada en espalda');
    expect('/enviar caso'.match(RE.sendCase)).not.toBeNull();
  });

  it('matches the turno inbox aliases', () => {
    for (const c of ['entrantes', 'turno', 'bandeja turno', 'bandeja de turno', '/entrantes']) {
      expect(c.match(RE.inbox), c).not.toBeNull();
    }
    expect('entrantes ya'.match(RE.inbox)).toBeNull();
  });

  it('matches "reclamar" bare and with a uuid', () => {
    expect('reclamar'.match(RE.claim)).not.toBeNull();
    expect(`reclamar ${VALID_UUID}`.match(RE.claim)?.[1]).toBe(VALID_UUID);
  });

  it('parsea varios destinos: círculos, personas y el motivo', async () => {
    const { parsearDestinos } = await import('../src/server.js');
    const uno = parsearDestinos('dermatologia sospecha de melanoma');
    expect(uno.circulos).toEqual(['dermatologia']);
    expect(uno.personas).toEqual([]);
    expect(uno.motivo).toBe('sospecha de melanoma');

    const varios = parsearDestinos(
      'dermatologia, 3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c, 9b1c2d3e-4f5a-4b6c-8d9e-0f1a2b3c4d5e urgente',
    );
    expect(varios.circulos).toEqual(['dermatologia']);
    expect(varios.personas).toEqual([
      '3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c',
      '9b1c2d3e-4f5a-4b6c-8d9e-0f1a2b3c4d5e',
    ]);
    expect(varios.motivo).toBe('urgente');

    // Repetir a la misma persona no la duplica; sin destinos, nada que derivar.
    const repe = parsearDestinos('3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c, 3F2A1B4C-5D6E-4F7A-8B9C-0D1E2F3A4B5C');
    expect(repe.personas).toHaveLength(1);
    expect(parsearDestinos('  ').circulos).toEqual([]);
  });

  it('matches "derivar a <destinos> [motivo]"', () => {
    // El regex solo separa el comando de sus destinos; quién es quién lo decide
    // `parsearDestinos` (el test de arriba).
    expect('derivar a dermatologia sospecha de melanoma'.match(RE.derive)?.[1])
      .toBe('dermatologia sospecha de melanoma');
    expect('derivar a comite_tumores'.match(RE.derive)?.[1]).toBe('comite_tumores');
    expect('derivar a dermatologia, 3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c'.match(RE.derive)?.[1])
      .toBe('dermatologia, 3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c');
    // sin destino no es el comando
    expect('derivar a'.match(RE.derive)).toBeNull();
  });

  it('matches "responder <texto>" including multi-line', () => {
    expect('responder probable dermatitis de contacto, indicar corticoide'.match(RE.answer)?.[1])
      .toBe('probable dermatitis de contacto, indicar corticoide');
    expect('responder linea1\nlinea2'.match(RE.answer)?.[1]).toBe('linea1\nlinea2');
    expect('responder'.match(RE.answer)).toBeNull();
  });
});
