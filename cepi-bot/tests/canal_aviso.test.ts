/**
 * Aviso de «pensando» de los canales (src/canalAviso.ts): de dónde sale el
 * nombre del paciente y cuándo NO corresponde decir «continuando con…».
 */
import { describe, it, expect } from 'vitest';
import { avisoContinuando, pacienteDeRespuesta } from '../src/canalAviso.js';

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
