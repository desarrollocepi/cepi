/**
 * Extracción de ficha desde el texto libre de DrPro (PAPER §21 / §22).
 *
 * DrPro no tiene los 27 grupos de la ficha: trae anamnesis, exploración,
 * diagnóstico y tratamiento en prosa. Por eso lo importado se queda en un 22% de
 * llenado. Pero medido sobre 300 fichas reales, esa prosa SÍ contiene los datos:
 * el 100% menciona la región afectada, el 62% la lesión elemental, el 36% el
 * tiempo de evolución. Este módulo los saca y los pone en sus campos.
 *
 * Tres reglas que lo hacen reversible, que es lo que permite iterar sin miedo:
 *
 *  1. **Lee del crudo, no de DrPro.** `drpro_raw` es inmutable y ya está en la
 *     base, así que el prompt se puede reescribir y volver a pasar las veces que
 *     haga falta sin pedirle nada a un sistema en producción.
 *  2. **No pisa lo que ya hay.** Solo rellena campos vacíos. Lo que capturó un
 *     médico, o lo que ya trajo mapeado la importación, es intocable.
 *  3. **Marca el origen campo a campo** en `ficha_fuente`. Sin esto no habría
 *     forma de distinguir lo que escribió una persona de lo que dedujo un modelo
 *     a partir de prosa con faltas de ortografía — y esa distinción es la que
 *     decide si un dato clínico se puede usar para algo serio.
 */
import { TodoErpMcpClient } from './mcpClient.js';
import { getLLMAdapter } from './llm.js';
import { anonimizarTextoClinico } from './anonimizar.js';

/** Campos que se piden al modelo, con su vocabulario cerrado cuando lo tienen. */
const OBJETIVO: Array<{ key: string; desc: string; tipo: 'bool' | 'texto' | 'opcion'; opciones?: string[] }> = [
  // §3 — anamnesis
  { key: 'tiempo_evolucion', tipo: 'texto',  desc: 'Cuánto lleva el cuadro. Copia la expresión del texto: "5 años", "3 meses", "2 semanas".' },
  { key: 'curso',            tipo: 'opcion', desc: 'Cómo evoluciona.', opciones: ['progresivo', 'regresivo', 'continuo', 'intermitente'] },
  { key: 'picor',            tipo: 'opcion', desc: 'Intensidad del prurito SI se menciona.', opciones: ['leve', 'moderado', 'severo'] },
  { key: 'dolor',            tipo: 'opcion', desc: 'Intensidad del dolor SI se menciona.', opciones: ['leve', 'moderado', 'severo'] },
  { key: 'causa_aparente',   tipo: 'texto',  desc: 'Desencadenante que el texto atribuya al cuadro (sol, estrés, contacto, fármaco…).' },
  { key: 'tratamientos_previos', tipo: 'texto', desc: 'Tratamientos que el paciente YA recibió antes de esta consulta.' },
  // §4 — examen físico
  { key: 'lesion_macula',   tipo: 'bool', desc: 'El texto describe mácula.' },
  { key: 'lesion_papula',   tipo: 'bool', desc: 'El texto describe pápula.' },
  { key: 'lesion_placa',    tipo: 'bool', desc: 'El texto describe placa.' },
  { key: 'lesion_vesicula', tipo: 'bool', desc: 'El texto describe vesícula.' },
  { key: 'lesion_ampolla',  tipo: 'bool', desc: 'El texto describe ampolla.' },
  { key: 'lesion_tumor',    tipo: 'bool', desc: 'El texto describe tumor o neoformación.' },
  { key: 'lesion_nodulo',   tipo: 'bool', desc: 'El texto describe nódulo.' },
  { key: 'lesion_ulcera',   tipo: 'bool', desc: 'El texto describe úlcera.' },
  { key: 'caract_eritema',        tipo: 'texto', desc: 'Menciones de eritema o fondo eritematoso; cita el fragmento.' },
  { key: 'caract_descamacion',    tipo: 'texto', desc: 'Menciones de descamación o escamas.' },
  { key: 'caract_exudacion',      tipo: 'texto', desc: 'Menciones de exudado, secreción o costra melicérica.' },
  { key: 'caract_liquenificacion',tipo: 'texto', desc: 'Menciones de liquenificación.' },
  { key: 'topo_unica',      tipo: 'bool', desc: 'Lesión única.' },
  { key: 'topo_multiples',  tipo: 'bool', desc: 'Lesiones múltiples.' },
  { key: 'topo_bilateral',  tipo: 'bool', desc: 'Distribución bilateral.' },
  { key: 'topo_simetrico',  tipo: 'bool', desc: 'Distribución simétrica.' },
  { key: 'topo_lineal',     tipo: 'bool', desc: 'Disposición lineal.' },
  { key: 'topo_circular',   tipo: 'bool', desc: 'Disposición circular o anular.' },
  { key: 'notas_examen',    tipo: 'texto', desc: 'Cualquier hallazgo del examen que no encaje arriba, en una línea.' },
];

/**
 * Regiones del mapa corporal, EXACTAMENTE las 38 claves que dibuja `ficha.html`.
 * Al modelo se le pide el nombre en castellano y acá se traduce: obligarle a
 * acertar claves como `antebrazo_der_post` sería pedirle que adivine, y una clave
 * inventada se descarta en silencio, que es la peor forma de perder un dato.
 *
 * El campo se guarda como TEXTO separado por comas (`torax,muslo_der_post`), no
 * como array: mandarlo como lista hacía fallar la validación del ERP entero.
 */
const REGIONES: Record<string, string> = {
  'cabeza': 'cabeza_ant', 'cara': 'cabeza_ant', 'frente': 'cabeza_ant', 'mejilla': 'cabeza_ant',
  'nariz': 'cabeza_ant', 'mentón': 'cabeza_ant', 'labio': 'cabeza_ant', 'párpado': 'cabeza_ant',
  'oreja': 'cabeza_ant', 'cuero cabelludo': 'cabeza_post', 'nuca': 'cabeza_post',
  'cuello': 'cuello_ant', 'nuca posterior': 'cuello_post',
  'tórax': 'torax', 'pecho': 'torax', 'mama': 'torax', 'abdomen': 'abdomen',
  'espalda': 'espalda_alta', 'espalda alta': 'espalda_alta', 'zona lumbar': 'lumbar',
  'glúteos': 'gluteos', 'pelvis': 'pelvis_ant', 'ingle': 'pelvis_ant',
  'hombro derecho': 'hombro_der_ant', 'hombro izquierdo': 'hombro_izq_ant',
  'brazo derecho': 'brazo_der_ant', 'brazo izquierdo': 'brazo_izq_ant',
  'antebrazo derecho': 'antebrazo_der_ant', 'antebrazo izquierdo': 'antebrazo_izq_ant',
  'mano derecha': 'mano_der', 'mano izquierda': 'mano_izq',
  'dorso de mano derecha': 'mano_der_dorso', 'dorso de mano izquierda': 'mano_izq_dorso',
  'muslo derecho': 'muslo_der_ant', 'muslo izquierdo': 'muslo_izq_ant',
  'pierna derecha': 'pierna_der_ant', 'pierna izquierda': 'pierna_izq_ant',
  'pie derecho': 'pie_der', 'pie izquierdo': 'pie_izq',
  'planta del pie derecho': 'pie_der_planta', 'planta del pie izquierdo': 'pie_izq_planta',
};

function esquemaParaPrompt(): string {
  const lineas = OBJETIVO.map(o => {
    const tipo = o.tipo === 'bool' ? 'true | null'
      : o.tipo === 'opcion' ? `${o.opciones!.map(x => `"${x}"`).join(' | ')} | null`
      : 'string | null';
    return `  "${o.key}": ${tipo},   // ${o.desc}`;
  });
  lineas.push(`  "regiones_afectadas": string[],   // solo de esta lista: ${Object.keys(REGIONES).join(', ')}`);
  return `{\n${lineas.join('\n')}\n}`;
}

const INSTRUCCIONES = `Eres un extractor de datos clínicos. Recibes el texto libre de una consulta
dermatológica ya realizada y devuelves SOLO un objeto JSON con los campos del esquema.

Reglas, en orden de importancia:

1. NO INVENTES. Si el texto no lo dice, el valor es null (o false/lista vacía). Es
   preferible un campo vacío a uno inventado: esto es una historia clínica.
2. No deduzcas por el diagnóstico. Que ponga "psoriasis" no autoriza a marcar
   "placa" ni "descamación" si el texto no los describe.
3. El texto viene en MAYÚSCULAS, abreviado y con faltas de ortografía
   ("DERMATOSISI", "D EVOLUCION", "ISGNOS"). Interprétalas, no las copies.
4. Para los campos de texto, cita el fragmento del original en minúscula, sin
   reescribirlo con tus palabras.
5. Responde el JSON y nada más. Sin explicación, sin markdown, sin \`\`\`.`;

/** Saca del crudo el texto que se le da al modelo. */
export function textoDelCrudo(crudo: string): string {
  let j: any;
  try { j = JSON.parse(crudo); } catch { return ''; }
  const dx = j?.diagnostico || {};
  const partes = [
    dx.anamnesis && `MOTIVO Y ANAMNESIS: ${dx.anamnesis}`,
    dx.exploracion && `EXAMEN FÍSICO: ${dx.exploracion}`,
    dx.diagnostico && `DIAGNÓSTICO: ${dx.diagnostico}`,
    dx.tratamiento && `TRATAMIENTO: ${dx.tratamiento}`,
    dx.evolucion && `EVOLUCIÓN: ${dx.evolucion}`,
    dx.observaciones && `OBSERVACIONES: ${dx.observaciones}`,
  ].filter(Boolean);
  // Los campos personalizados llegan como HTML renderizado.
  for (const h of j?.campos || []) {
    const limpio = String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (limpio) partes.push(limpio);
  }
  return partes.join('\n').replace(/\s+\n/g, '\n').trim();
}

/** El JSON del modelo, tolerando que lo envuelva en markdown pese a lo pedido. */
function parsearRespuesta(txt: string): Record<string, any> | null {
  const limpio = String(txt || '').replace(/```(?:json)?/gi, '').trim();
  const i = limpio.indexOf('{');
  const f = limpio.lastIndexOf('}');
  if (i < 0 || f <= i) return null;
  try { return JSON.parse(limpio.slice(i, f + 1)); } catch { return null; }
}

/**
 * Filtra lo que devolvió el modelo contra el esquema. Un extractor que escribe
 * en la ficha lo que le dé la gana es peor que no tener extractor: acá solo pasan
 * las claves declaradas, con el tipo y el vocabulario declarados.
 */
export function validar(bruto: Record<string, any> | null): Record<string, any> {
  const out: Record<string, any> = {};
  if (!bruto) return out;
  for (const o of OBJETIVO) {
    const v = bruto[o.key];
    if (v === null || v === undefined || v === '' || v === false) continue;
    if (o.tipo === 'bool') { if (v === true || v === 'true') out[o.key] = true; continue; }
    if (o.tipo === 'opcion') {
      const s = String(v).toLowerCase().trim();
      if (o.opciones!.includes(s)) out[o.key] = s;
      continue;
    }
    const s = String(v).trim();
    if (s && s.toLowerCase() !== 'null') out[o.key] = s.slice(0, 500);
  }
  const regs = bruto.regiones_afectadas;
  if (Array.isArray(regs)) {
    const claves = regs.map((r: any) => REGIONES[String(r).toLowerCase().trim()]).filter(Boolean);
    // Texto separado por comas, como lo guarda el mapa corporal de la ficha.
    if (claves.length) out.regiones_afectadas = [...new Set(claves)].join(',');
  }
  return out;
}

export interface ResultadoExtraccion {
  episode_id: string;
  ok: boolean;
  escritos: string[];
  omitidos_por_ocupado: string[];
  /** Qué se anonimizó antes de enviar, por clase. Audita sin exponer el texto. */
  anonimizado?: Record<string, number>;
  motivo?: string;
}

/**
 * Extrae y escribe. `soloVacios` es el comportamiento por defecto y no debería
 * apagarse salvo para reprocesar: con él, lo que ya tiene valor —venga del médico
 * o de la importación— nunca se toca.
 */
export async function extraerEpisodio(
  mcp: TodoErpMcpClient,
  episodeId: string,
  opts: { soloVacios?: boolean } = {},
): Promise<ResultadoExtraccion> {
  const soloVacios = opts.soloVacios !== false;
  const base: ResultadoExtraccion = { episode_id: episodeId, ok: false, escritos: [], omitidos_por_ocupado: [] };

  const r: any = await mcp.call('entities.get', { id: episodeId });
  const ep = r?.data?.data;
  if (!ep) return { ...base, motivo: 'episodio no encontrado' };
  if (!ep.drpro_raw) return { ...base, motivo: 'sin crudo de DrPro' };

  const crudoTexto = textoDelCrudo(ep.drpro_raw);
  if (crudoTexto.length < 40) return { ...base, motivo: 'texto libre demasiado corto' };

  // Nada sale hacia el proveedor sin pasar por acá. El texto ya venía sin nombre ni
  // cédula del paciente —el crudo del episodio no lleva el bloque `paciente`— pero
  // sí traía el nombre del médico en el 100% de los casos y fechas exactas de
  // procedimientos, que reidentifican cruzando con la agenda de la clínica.
  const { texto, sustituciones } = anonimizarTextoClinico(crudoTexto, ep.fecha);

  const llm = await getLLMAdapter();
  const prompt = `${INSTRUCCIONES}\n\nESQUEMA:\n${esquemaParaPrompt()}\n\nTEXTO DE LA CONSULTA:\n${texto}`;
  const resp: any = await llm.step([{ role: 'user', content: prompt }] as any, []);
  const propuesto = validar(parsearRespuesta(resp?.text || ''));
  if (!Object.keys(propuesto).length) return { ...base, motivo: 'el modelo no devolvió nada utilizable' };

  const patch: Record<string, any> = {};
  const ocupados: string[] = [];
  for (const [k, v] of Object.entries(propuesto)) {
    const actual = ep[k];
    const vacio = actual === null || actual === undefined || actual === '' || actual === false ||
      (Array.isArray(actual) && actual.length === 0);
    if (soloVacios && !vacio) { ocupados.push(k); continue; }
    patch[k] = v;
  }
  if (!Object.keys(patch).length) {
    return { ...base, ok: true, omitidos_por_ocupado: ocupados, motivo: 'nada nuevo que escribir' };
  }

  // El origen se guarda junto al dato: sin esto, dentro de un mes nadie sabría
  // qué campos escribió un médico y cuáles dedujo un modelo de un texto con faltas.
  let fuente: Record<string, string> = {};
  try { fuente = ep.ficha_fuente ? JSON.parse(ep.ficha_fuente) : {}; } catch { fuente = {}; }
  const sello = new Date().toISOString().slice(0, 10);
  for (const k of Object.keys(patch)) fuente[k] = `ia:${llm.name}:${sello}`;
  patch.ficha_fuente = JSON.stringify(fuente);

  const upd: any = await mcp.call('entities.update', { id: episodeId, record_type: 'business', data: patch });
  if (upd?.ok === false || upd?.isError) {
    return { ...base, motivo: `no se pudo guardar: ${upd?.error || 'error'}` };
  }
  return {
    episode_id: episodeId, ok: true,
    escritos: Object.keys(patch).filter(k => k !== 'ficha_fuente'),
    omitidos_por_ocupado: ocupados,
    anonimizado: sustituciones,
  };
}
