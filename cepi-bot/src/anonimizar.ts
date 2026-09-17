/**
 * Anonimizado del texto clínico ANTES de que salga hacia un LLM externo.
 *
 * El crudo del episodio ya no lleva el bloque `paciente`, así que no salen nombre,
 * cédula, teléfono ni correo — verificado sobre 300 fichas reales, cero casos. Pero
 * «no lleva identificadores directos» no es «es anónimo»: quedan dos vías de
 * reidentificación que este módulo cierra.
 *
 *  · **El profesional.** `NOMBRE DEL PROFESIONAL: DR RAMIREZ/ PG CASTRO` aparecía en
 *    las 300. No es dato del paciente, pero identifica a personas y no aporta nada a
 *    la extracción.
 *  · **Las fechas exactas.** «biopsia el 31/07/2026, cirugía el 14/08» describe a
 *    una persona concreta para cualquiera que tenga la agenda de la clínica. Se
 *    convierten en distancias («hace 5 semanas»), que es justo lo que la ficha
 *    necesita para §3.2 y no sirve para cruzar con una agenda.
 *
 * Lo que NO se toca es el contenido clínico: lesión, topografía, síntomas y
 * tratamiento son el motivo de mandar el texto. Anonimizar hasta romperlos dejaría
 * un texto seguro e inútil.
 */

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export interface ResultadoAnonimizado {
  texto: string;
  /** Cuántas sustituciones de cada clase; sirve para auditar sin ver el contenido. */
  sustituciones: Record<string, number>;
}

/** Distancia legible entre dos fechas, que es lo que la ficha llama «evolución». */
function haceCuanto(fecha: Date, ref: Date): string {
  const dias = Math.round((ref.getTime() - fecha.getTime()) / 86_400_000);
  if (!isFinite(dias)) return '<fecha>';
  if (dias < 0) return 'en los próximos días';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 14) return `hace ${dias} días`;
  if (dias < 60) return `hace ${Math.round(dias / 7)} semanas`;
  if (dias < 730) return `hace ${Math.round(dias / 30)} meses`;
  return `hace ${Math.round(dias / 365)} años`;
}

/**
 * @param texto  el texto clínico tal cual sale del crudo
 * @param fechaRef  fecha del episodio; sin ella las fechas van a `<fecha>` en vez
 *                  de a una distancia, porque no hay contra qué medir
 */
export function anonimizarTextoClinico(texto: string, fechaRef?: string | Date | null): ResultadoAnonimizado {
  const cuenta: Record<string, number> = {};
  const marca = (clase: string) => { cuenta[clase] = (cuenta[clase] || 0) + 1; };
  let t = String(texto || '');

  // 1. Correos. Van primero: llevan puntos y arrobas que confunden al resto.
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, () => { marca('correo'); return '<correo>'; });

  // 2. El campo del profesional, con etiqueta y valor. El valor puede traer varios
  //    separados por «/» y llegar hasta el siguiente campo en MAYÚSCULAS o el fin.
  t = t.replace(/NOMBRE DEL PROFESIONAL\s*:?\s*[^\n]*/gi, () => {
    marca('profesional'); return 'NOMBRE DEL PROFESIONAL: <profesional>';
  });

  // 3. Tratamientos y títulos sueltos: «DR RAMIREZ», «Dra. Pérez», «PG CASTRO».
  t = t.replace(/\b(dr|dra|md|pg|lcdo|lcda)\.?\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*(\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*)?/gi,
    () => { marca('profesional'); return '<profesional>'; });

  // 4. Identificadores numéricos. La cédula ecuatoriana son 10 dígitos; el móvil
  //    empieza por 09. Se hacen antes que las fechas para que no se los coma el
  //    patrón de dd/mm/yyyy.
  t = t.replace(/\b09\d{8}\b/g, () => { marca('teléfono'); return '<teléfono>'; });
  t = t.replace(/\b\d{10}\b/g,  () => { marca('cédula'); return '<cédula>'; });
  t = t.replace(/\b(?:\+?593)\s?\d{8,9}\b/g, () => { marca('teléfono'); return '<teléfono>'; });

  // 5. Fechas → distancia. Reidentifican cruzando con la agenda de la clínica.
  const ref = fechaRef ? new Date(fechaRef) : null;
  const valida = ref && !isNaN(ref.getTime()) ? ref : null;
  const sustituir = (y: number, m: number, d: number) => {
    marca('fecha');
    if (!valida) return '<fecha>';
    return haceCuanto(new Date(y, m - 1, d), valida);
  };
  // dd/mm/yyyy y dd-mm-yyyy (y con año de dos cifras)
  t = t.replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g, (_m, d, mo, y) => {
    const anio = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    return sustituir(anio, Number(mo), Number(d));
  });
  // yyyy-mm-dd
  t = t.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_m, y, mo, d) => sustituir(Number(y), Number(mo), Number(d)));
  // «12 de agosto de 2026» / «12 de agosto»
  t = t.replace(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de\s+(\d{4}))?\b/gi, (m, d, mes, y) => {
    const nm = MESES[String(mes).toLowerCase()];
    if (!nm) return m;   // «12 de largo», «3 de diámetro»: no es una fecha
    return sustituir(y ? Number(y) : (valida ? valida.getFullYear() : 2000), nm, Number(d));
  });

  return { texto: t, sustituciones: cuenta };
}
