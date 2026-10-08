/**
 * Captura campo por campo de un formulario, común a los canales de chat.
 *
 * WhatsApp y Telegram no pueden pintar un formulario: lo recorren pregunta por
 * pregunta y recién al final lo envían al cerebro como lo haría la web. Acá
 * vive lo que no depende del canal —qué formularios se recorren, qué opciones
 * tiene un campo, cómo se arma el envío— y cada adaptador pone el transporte
 * (botones inline en Telegram; botones de respuesta o lista numerada en WhatsApp).
 */
import type { BotForm, BotFormField } from './flowV1.js';

/** Recorrido en curso de un formulario. */
export interface FormWalk { form: BotForm; idx: number; answers: Record<string, any>; }

/**
 * Forms walked field-by-field: ficha sections and the new-patient form.
 * The search form stays as text — any typed text already triggers a search.
 * (Without walking `patient_new`, a user who taps "nuevo paciente" and then
 * sends just the cédula would fall through to the search branch of the brain.)
 */
export function isWalkableForm(form: any): form is BotForm {
  return !!form && typeof form.id === 'string'
    && (form.id.startsWith('ficha_grp_') || form.id === 'patient_new')
    && Array.isArray(form.fields) && form.fields.some((f: any) => f.type !== 'heading');
}

/** Selectable options for a walk field (Sí/No for checkbox; field options otherwise). */
export function walkOptions(f: BotFormField): Array<{ label: string; value: any }> {
  if (f.type === 'checkbox') return [{ label: 'Sí', value: true }, { label: 'No', value: false }];
  return (f.options || []).map(o => typeof o === 'string'
    ? { label: o, value: o }
    : { label: o.label, value: (o as any).value });
}

/**
 * ¿El campo ya tiene valor guardado? El cerebro manda la sección con lo que ya
 * hay en la ficha (`form.values`). Un canal pregunta solo lo que falta: volver a
 * pedir lo ya contestado —por ejemplo tras guardar media sección— cansa y
 * arriesga pisar un dato bueno.
 */
export function yaTieneValor(w: FormWalk, f: BotFormField): boolean {
  if (!f.key || f.type === 'image_upload') return false;
  const v = (w.form.values || {})[f.key];
  return v !== undefined && v !== null && v !== '';
}

/** Posición «(3/7)» del campo actual entre los que se preguntan. */
export function posicion(w: FormWalk): { pos: number; n: number } {
  const n = w.form.fields.filter(x => x.type !== 'heading').length;
  const pos = w.form.fields.slice(0, w.idx).filter(x => x.type !== 'heading').length + 1;
  return { pos, n };
}

/** Índice del último campo que se pregunta: a él se vuelve si el envío no salió. */
export function ultimoCampo(w: FormWalk): number {
  let i = w.form.fields.length - 1;
  while (i > 0 && w.form.fields[i].type === 'heading') i--;
  return i;
}

/**
 * Lo que se le manda al cerebro al terminar: el envío estructurado de una
 * sección de la ficha, o el comando de `submit_send` con las respuestas.
 */
export function cuerpoDeEnvio(w: FormWalk): { form_submission: { form_id: string; data: Record<string, any> } } | { message: string } {
  if (w.form.submit_mode === 'structured') {
    return { form_submission: { form_id: w.form.id, data: w.answers } };
  }
  if (w.form.submit_send) {
    // `||` is the field separator of submit_send commands (e.g. /nuevo-paciente)
    // — scrub it from free-text answers so they can't break the parse.
    return { message: w.form.submit_send.replace(/\{(\w+)\}/g, (_m, k) =>
      String(w.answers[k] ?? '').replace(/\|{2,}/g, ' ').replace(/\s+/g, ' ').trim()) };
  }
  return { message: Object.values(w.answers).join(' ').trim() || 'ok' };
}

/**
 * Cola por chat. Los webhooks entregan sin esperar a que termine el anterior:
 * dos mensajes seguidos («nuevo paciente» y enseguida la cédula) correrían a la
 * vez y el segundo no vería el recorrido que abrió el primero. Chats distintos
 * siguen en paralelo; la entrada se borra cuando la cola se vacía.
 */
export function colaPorChat<K>(canal: string): (clave: K, tarea: () => Promise<void>) => Promise<void> {
  const colas = new Map<K, Promise<void>>();
  return (clave, tarea) => {
    const prev = colas.get(clave) || Promise.resolve();
    const next = prev.then(tarea, tarea).catch(e =>
      console.error(`[${canal}] queued task error:`, e?.message || e));
    colas.set(clave, next);
    next.finally(() => { if (colas.get(clave) === next) colas.delete(clave); });
    return next;
  };
}
