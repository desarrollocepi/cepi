/**
 * Estado de un canal de chat que sobrevive a un reinicio del bot (PAPER §27.8).
 *
 * El canal lleva en memoria con quién está cada chat: su sesión, su paciente
 * activo, la sección de la ficha que está recorriendo con sus respuestas, la
 * pregunta que tiene abierta. Cada deploy reinicia el proceso; sin esto, cada
 * deploy le «cerraba la sesión» a todo el que estuviera en medio de una
 * consulta y se perdían las respuestas de la sección que no se habían enviado.
 *
 * Es un archivo JSON por canal, fuera del directorio del código (un deploy lo
 * reemplaza), escrito de forma atómica y con permisos 600: lleva nombres de
 * pacientes y respuestas clínicas a medio enviar. No lleva credenciales: el JWT
 * de cada chat se vuelve a pedir cuando hace falta.
 *
 * `CEPI_BOT_STATE_DIR` elige el directorio (por defecto `~/.cepi-bot`). Bajo
 * tests no se persiste, salvo que el test fije ese directorio.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface EstadoDeCanal {
  /** Lo guardado en el arranque anterior, o null si no hay (o no se puede leer). */
  cargar(): any | null;
  /** Pide guardar: `tomar` arma la foto del estado. Se agrupan las ráfagas. */
  guardar(tomar: () => unknown): void;
  /** Guarda ya, sin esperar (apagado del proceso). */
  guardarYa(tomar: () => unknown): void;
}

const RETARDO_MS = 250;

export function crearEstado(nombreDe: () => string): EstadoDeCanal {
  // El directorio se resuelve al usarlo, no al cargar el módulo: la configuración
  // puede llegar después (dotenv, el vault) y un test la fija antes de arrancar.
  const dirDe = (): string => process.env.CEPI_BOT_STATE_DIR
    || (process.env.VITEST ? '' : path.join(os.homedir(), '.cepi-bot'));
  const archivoDe = (): string => { const d = dirDe(); return d ? path.join(d, `${nombreDe()}.json`) : ''; };
  let reloj: ReturnType<typeof setTimeout> | null = null;

  const escribir = (tomar: () => unknown): void => {
    const dir = dirDe(); const archivo = archivoDe();
    if (!archivo) return;
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${archivo}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(tomar()), { mode: 0o600 });
      fs.renameSync(tmp, archivo);
    } catch (e: any) {
      console.error(`[estado:${nombreDe()}] no se pudo guardar:`, e?.message || e);
    }
  };

  return {
    cargar() {
      const archivo = archivoDe();
      if (!archivo) return null;
      try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); }
      catch { return null; }
    },
    guardar(tomar) {
      if (!archivoDe()) return;
      if (reloj) clearTimeout(reloj);
      reloj = setTimeout(() => { reloj = null; escribir(tomar); }, RETARDO_MS);
      if (typeof (reloj as any).unref === 'function') (reloj as any).unref();
    },
    guardarYa(tomar) {
      if (reloj) { clearTimeout(reloj); reloj = null; }
      escribir(tomar);
    },
  };
}
