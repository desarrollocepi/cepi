// Reglas compartidas del recorrido de formularios en los canales (Telegram y WhatsApp).
import { describe, it, expect } from 'vitest';
import { esRelatoLibre } from '../src/canalWalk.js';

const RELATO = 'Paciente de 34 años con placa eritematosa descamativa en codo derecho desde hace 2 meses, con prurito.';

describe('esRelatoLibre', () => {
  it('un relato clínico en un campo corto no es la respuesta (pasó: quedó como Dirección)', () => {
    expect(esRelatoLibre(RELATO, { key: 'direccion', label: 'Dirección', type: 'text' })).toBe(true);
    expect(esRelatoLibre(RELATO, { key: 'fecha_nac', label: 'Fecha de nacimiento', type: 'date' })).toBe(true);
  });

  it('en un campo de texto largo el relato SÍ es la respuesta', () => {
    expect(esRelatoLibre(RELATO, { key: 'motivo_consulta', label: 'Motivo de consulta', type: 'textarea' })).toBe(false);
  });

  it('una dirección larga sigue siendo una dirección', () => {
    expect(esRelatoLibre('Av. 10 de Agosto N24-121 y Luis Cordero, edificio Torres, piso 3',
      { key: 'direccion', label: 'Dirección', type: 'text' })).toBe(false);
  });
});
