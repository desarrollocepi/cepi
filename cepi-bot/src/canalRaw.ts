/**
 * Registro crudo de la conversación en un canal de chat (PAPER §27.7).
 *
 * `bot_session.turns` guarda lo que el cerebro vio: el texto de cada turno que
 * le llegó. En un canal pasan cosas que nunca llegan ahí —la respuesta a cada
 * pregunta de un recorrido, el toque en un botón, un mensaje cancelado en la
 * ventana de gracia, lo que el bot escribió de verdad en pantalla—. Este
 * registro guarda todo eso tal cual, con el mensaje entrante como lo mandó el
 * proveedor, para poder reprocesar la sesión contra lo que quedó en la ficha.
 *
 * Es un búfer por chat: los eventos viajan con el siguiente turno al cerebro
 * (`canal_raw` en el cuerpo), que los anexa a la sesión. Si pasa un rato sin
 * turno —un recorrido a medias—, `vaciar` los manda solos. Lo anterior a que
 * exista la sesión espera en el búfer y entra con el primer turno.
 */

export interface EventoCrudo {
  ts: string;
  canal: string;
  /** `in`: lo mandó la persona. `out`: lo mandó el bot. `sys`: algo que hizo el canal. */
  dir: 'in' | 'out' | 'sys';
  tipo: string;
  texto?: string;
  /** El mensaje entrante como lo entregó el proveedor, o el detalle del evento. */
  crudo?: unknown;
}

/** Tope del búfer de un chat: si el cerebro no responde, no crece sin fin. */
const MAX_EVENTOS = 500;
/** Sin turno que los lleve, los eventos se mandan solos tras este rato. */
const VACIAR_TRAS_MS = 30_000;

type Enviar = (clave: string, eventos: EventoCrudo[]) => Promise<boolean>;

export interface RegistroCrudo {
  /** Desde acá se registra ese chat. Antes, `anotar` no hace nada: quien no tiene acceso no deja rastro clínico. */
  activar(clave: string | number): void;
  anotar(clave: string | number, ev: Omit<EventoCrudo, 'ts' | 'canal'>): void;
  /** Saca los eventos para mandarlos con un turno. Si el turno falla, `devolver`. */
  tomar(clave: string | number): EventoCrudo[];
  devolver(clave: string | number, eventos: EventoCrudo[]): void;
  /** Manda ya lo pendiente de todos los chats (apagado del proceso). */
  vaciarTodo(): Promise<void>;
}

const registros: RegistroCrudo[] = [];

/**
 * `enviar` es cómo el canal manda eventos sin turno: devuelve `false` si no
 * pudo (sin sesión todavía, sin credencial) y los eventos vuelven al búfer.
 */
export function crearRegistroCrudo(canal: string, enviar: Enviar): RegistroCrudo {
  const activos = new Set<string>();
  const bufer = new Map<string, EventoCrudo[]>();
  const relojes = new Map<string, ReturnType<typeof setTimeout>>();

  const vaciar = async (k: string): Promise<void> => {
    relojes.delete(k);
    const eventos = bufer.get(k);
    if (!eventos?.length) return;
    bufer.delete(k);
    let ok = false;
    try { ok = await enviar(k, eventos); } catch (e: any) {
      console.error(`[${canal}] registro crudo:`, e?.message || e);
    }
    if (!ok) reg.devolver(k, eventos);
  };

  const armar = (k: string): void => {
    const previo = relojes.get(k);
    if (previo) clearTimeout(previo);
    const t = setTimeout(() => { void vaciar(k); }, VACIAR_TRAS_MS);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    relojes.set(k, t);
  };

  const reg: RegistroCrudo = {
    activar(clave) { activos.add(String(clave)); },
    anotar(clave, ev) {
      const k = String(clave);
      if (!activos.has(k)) return;
      const lista = bufer.get(k) || [];
      lista.push({ ts: new Date().toISOString(), canal, ...ev });
      bufer.set(k, lista.slice(-MAX_EVENTOS));
      armar(k);
    },
    tomar(clave) {
      const k = String(clave);
      const eventos = bufer.get(k) || [];
      bufer.delete(k);
      const t = relojes.get(k);
      if (t) { clearTimeout(t); relojes.delete(k); }
      return eventos;
    },
    devolver(clave, eventos) {
      if (!eventos.length) return;
      const k = String(clave);
      bufer.set(k, [...eventos, ...(bufer.get(k) || [])].slice(-MAX_EVENTOS));
    },
    async vaciarTodo() {
      for (const t of relojes.values()) clearTimeout(t);
      await Promise.all([...bufer.keys()].map(k => vaciar(k)));
    },
  };
  registros.push(reg);
  return reg;
}

/** Manda lo pendiente de todos los canales. Lo llama el apagado del proceso. */
export async function vaciarRegistrosCrudos(): Promise<void> {
  await Promise.all(registros.map(r => r.vaciarTodo()));
}
