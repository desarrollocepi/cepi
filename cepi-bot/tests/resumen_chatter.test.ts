/**
 * «ver chatter» en un canal: la web pinta el feed desde los datos de la tool;
 * por WhatsApp o Telegram solo llegaba «Feed de actividad del episodio.».
 */
import { describe, it, expect } from 'vitest';

process.env.PORT = '0';
process.env.WHATSAPP_WEBHOOK_PORT = '0';
process.env.TELEGRAM_WEBHOOK_PORT = '0';
process.env.TELEGRAM_PUBLIC_URL = '';
process.env.TELEGRAM_BOT_TOKEN = '';

describe('resumenDeChatter', () => {
  it('lista las entradas, la más reciente primero: quién, cuándo y qué', async () => {
    const { resumenDeChatter } = await import('../src/server.js');
    const texto = resumenDeChatter([
      { type: 'create', author_name: 'Ana Pérez', created_at: '2026-10-07T10:00:00Z' },
      { type: 'change', author_name: 'Ana Pérez', created_at: '2026-10-08T10:00:00Z',
        changes: { direccion: { from: null, to: 'Av. Uno', label: 'Dirección' }, telefono: { from: null, to: '555', label: 'Teléfono' } } },
      { type: 'note', author_name: 'Dra. Derma', created_at: '2026-10-08T12:00:00Z', body: 'control en 7 días' },
    ]);
    expect(texto.split('\n')).toEqual([
      '• 08/10 Dra. Derma: control en 7 días',
      '• 08/10 Ana Pérez: actualizó Dirección, Teléfono',
      '• 07/10 Ana Pérez: creó el registro',
    ]);
    // Los valores de los campos no se vuelcan: el feed dice qué cambió, no el dato.
    expect(texto).not.toContain('Av. Uno');
  });

  it('acepta la forma {data: [...]}, recorta a las últimas y dice cuántas quedan', async () => {
    const { resumenDeChatter } = await import('../src/server.js');
    const muchas = Array.from({ length: 13 }, (_, i) => ({ type: 'note', author_name: 'A', created_at: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`, body: `n${i}` }));
    const texto = resumenDeChatter({ data: muchas });
    expect(texto.split('\n')).toHaveLength(11);
    expect(texto).toContain('(y 3 entrada(s) anteriores)');
    expect(resumenDeChatter([])).toBe('Sin actividad registrada.');
  });
});
