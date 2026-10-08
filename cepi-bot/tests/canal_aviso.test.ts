/**
 * Aviso de «pensando» de los canales (src/canalAviso.ts): de dónde sale el
 * nombre del paciente y cuándo NO corresponde decir «continuando con…».
 */
import { describe, it, expect } from 'vitest';
import { abrirGracia, avisoContinuando, cancelarGracia, graciaMs, pacienteDeRespuesta } from '../src/canalAviso.js';

describe('pacienteDeRespuesta', () => {
  const con = (status_header: string) => ({ active_patient_id: 'p-1', status_header });

  it('saca el nombre de las tres formas del status_header', () => {
    expect(pacienteDeRespuesta(con('👤 Juan Pérez'))).toBe('Juan Pérez');
    expect(pacienteDeRespuesta(con('👤 Juan Pérez (consulta de información)'))).toBe('Juan Pérez');
    expect(pacienteDeRespuesta(con('👤 Juan Pérez — ficha §2.1 Antecedentes'))).toBe('Juan Pérez');
  });

  it('sin paciente activo no hay nombre, diga lo que diga el header', () => {
    expect(pacienteDeRespuesta({ status_header: '📋 Buscando paciente' })).toBe('');
    expect(pacienteDeRespuesta({ status_header: '👤 Juan Pérez' })).toBe('');
    expect(pacienteDeRespuesta(null)).toBe('');
  });
});

describe('avisoContinuando', () => {
  it('nombra al paciente', () => {
    expect(avisoContinuando('Juan Pérez', 'tiene prurito')).toBe('⏳ Continuando con Juan Pérez…');
  });

  it('calla sin paciente', () => {
    expect(avisoContinuando(undefined, 'hola')).toBe('');
    expect(avisoContinuando('  ', 'hola')).toBe('');
  });

  it('calla cuando el mensaje cambia o suelta al paciente', () => {
    for (const m of ['salir paciente', '/salir', 'activar paciente abc', 'nuevo paciente',
      '/nuevo-paciente 1 || a || b', 'paciente', 'buscar paciente', 'menú', 'cancelar']) {
      expect(avisoContinuando('Juan Pérez', m), m).toBe('');
    }
  });

  it('una frase que solo empieza parecido sí lleva aviso', () => {
    expect(avisoContinuando('Juan Pérez', 'pacientemente esperó')).not.toBe('');
    expect(avisoContinuando('Juan Pérez', 'nuevos síntomas desde ayer')).not.toBe('');
  });
});

describe('ventana de gracia', () => {
  it('vence sola y el turno sigue', async () => {
    const { token, espera } = abrirGracia('chat', 20);
    expect(await espera).toBe(true);
    expect(cancelarGracia(token, 'chat')).toBe(false);      // ya no hay qué cancelar
  });

  it('cancelada a tiempo, el turno no sigue; una sola vez', async () => {
    const { token, espera } = abrirGracia(42, 5000);
    expect(cancelarGracia(token, 42)).toBe(true);
    expect(await espera).toBe(false);
    expect(cancelarGracia(token, 42)).toBe(false);
  });

  it('solo la cancela su dueño', async () => {
    const { token, espera } = abrirGracia('a', 30);
    expect(cancelarGracia(token, 'b')).toBe(false);
    expect(await espera).toBe(true);
  });

  it('CEPI_CANAL_GRACIA_MS=0 la apaga; sin variable son 3 s', () => {
    const antes = process.env.CEPI_CANAL_GRACIA_MS;
    process.env.CEPI_CANAL_GRACIA_MS = '0';
    expect(graciaMs()).toBe(0);
    delete process.env.CEPI_CANAL_GRACIA_MS;
    expect(graciaMs()).toBe(3000);
    if (antes !== undefined) process.env.CEPI_CANAL_GRACIA_MS = antes;
  });
});
