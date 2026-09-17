/**
 * V1 conversational flow gate (docs/CHATBOT_FLOW.md).
 *
 * Implements the mode handshake + patient search/create flow in front of
 * the existing slash-command and LLM handlers. Returns a response object
 * when it handled the turn, or `null` to let the rest of the pipeline run.
 */
import { TodoErpMcpClient } from './mcpClient.js';
import { BotSession, saveSession } from './sessionStore.js';
import { inspectAttachment } from './imageInspect.js';

const PATIENT_ENTITY_ID = '11000000-0000-0000-0000-000000000000';
const EPISODE_ENTITY_ID = '12000000-0000-0000-0000-000000000000';
const CLINICAL_IMAGE_ENTITY_ID = '16000000-0000-0000-0000-000000000000';
const CONSENT_ENTITY_ID = '18000000-0000-0000-0000-000000000000';

export interface QuickReply { label: string; send: string; }

/** A field of a bot-rendered form. */
export interface BotFormField {
  /** Omitted for decorative `heading` fields. */
  key?: string;
  label: string;
  type?: 'text' | 'textarea' | 'checkbox' | 'radio' | 'heading' | 'entity_search' | 'icd_search' | 'date' | 'body_map' | 'image_upload';
  placeholder?: string;
  required?: boolean;
  /** `image_upload` only — allow selecting more than one image. */
  multiple?: boolean;
  /** `radio` only — the available choices. */
  options?: Array<string | { label: string; value: string | number | boolean }>;
  // `entity_search` only — live autocomplete against /api/entities:
  entity_id?: string;
  min_chars?: number;
  page_size?: number;
  /** Message template sent when an option is picked ({id}, {field}…). */
  on_select_send?: string;
  /** data fields joined to build each option's primary label. */
  result_label?: string[];
  /** data field shown as each option's secondary line. */
  result_sub?: string;
}

/** A secondary action button shown alongside a form's submit button. */
export interface BotFormAction { label: string; send: string; }

/**
 * A form the bot asks the frontend to render inline in the chat.
 * On submit, the frontend interpolates field values into `submit_send`
 * ({key} placeholders) and sends the result as a normal chat message —
 * so no special server-side submission handler is needed.
 */
export interface BotForm {
  id: string;
  title: string;
  fields: BotFormField[];
  submit_label?: string;
  /** When set, a submit button interpolates field values into this template. */
  submit_send?: string;
  /**
   * 'structured' — the form posts a { form_id, data } payload (ficha sections).
   * Default (unset) — interpolates `submit_send` into a plain chat message.
   */
  submit_mode?: 'message' | 'structured';
  actions?: BotFormAction[];
  /** Pre-filled field values, keyed by field key. */
  values?: Record<string, unknown>;
}

export interface FlowResponse {
  text: string;
  quick_replies?: QuickReply[];
  /** present (form or null) ⇒ change the persisted active form; absent ⇒ keep it. */
  form?: BotForm | null;
  pending_action_set?: boolean;
  bookmarks?: FichaBookmark[];
  /** §4.7 just created these clinical_image ids — the frontend polls
   *  cepi-isic for them and surfaces the classification once the worker
   *  finishes. */
  await_isic?: string[];
}

/**
 * Patient search form: a live autocomplete dropdown. Typing ≥3 chars queries
 * patients by cédula or nombre; picking an option activates that patient.
 */
const PATIENT_SEARCH_FORM: BotForm = {
  id: 'patient_search',
  title: 'Buscar paciente',
  fields: [
    {
      key: 'patient',
      label: 'Cédula o nombre',
      type: 'entity_search',
      entity_id: PATIENT_ENTITY_ID,
      min_chars: 3,
      page_size: 20,
      placeholder: 'Escribí al menos 3 caracteres…',
      on_select_send: 'activar paciente {id}',
      result_label: ['nombre', 'apellidos'],
      result_sub: 'cedula',
    },
  ],
  actions: [{ label: '+ Nuevo paciente', send: 'nuevo paciente' }],
};

/**
 * New-patient form: two required fields submitted in a single turn.
 * The frontend interpolates the values into the `/nuevo-paciente` command
 * (the `||` separator keeps cédula and nombre unambiguous).
 */
const PATIENT_NEW_FORM: BotForm = {
  id: 'patient_new',
  title: 'Nuevo paciente',
  fields: [
    { key: 'cedula', label: 'Cédula', placeholder: 'Ej: 12345678', required: true },
    { key: 'nombre', label: 'Nombres', placeholder: 'Ej: Juan', required: true },
    { key: 'apellidos', label: 'Apellidos', placeholder: 'Ej: Pérez', required: true },
  ],
  submit_label: 'Crear paciente',
  submit_send: '/nuevo-paciente {cedula} || {nombre} || {apellidos}',
};

// ── Ficha clínica (docs/ficha.html) — campos agrupados ─────────────────────
// La ficha se recorre como grupos atómicos: un formulario por grupo, y cada
// grupo es un "bookmark" en el riel lateral del chat.

// Closed yes/no question rendered as a single radio (not an ambiguous checkbox).
const SI_NO: Array<{ label: string; value: boolean }> = [
  { label: 'Sí', value: true },
  { label: 'No', value: false },
];

export interface FichaGroup {
  id: string;
  label: string;
  category: string;
  target: 'patient' | 'episode';
  fields: BotFormField[];
}

interface FichaFieldDef {
  category: string;
  target: 'patient' | 'episode';
  field: BotFormField;
}

// Todos los campos de la ficha, en orden — un bookmark / un formulario
// atómico por campo (una pregunta por formulario), agrupados por categoría.
const FICHA_FIELD_DEFS: FichaFieldDef[] = [
  // §1 Filiación (paciente)
  { category: 'Filiación', target: 'patient', field: { key: 'direccion', label: 'Dirección', type: 'text' } },
  { category: 'Filiación', target: 'patient', field: { key: 'telefono', label: 'Teléfono', type: 'text' } },
  { category: 'Filiación', target: 'patient', field: { key: 'sector_ciudad', label: 'Sector / Ciudad', type: 'text' } },
  { category: 'Filiación', target: 'patient', field: { key: 'ocupacion', label: 'Ocupación', type: 'text' } },
  { category: 'Filiación', target: 'patient', field: { key: 'email', label: 'Correo', type: 'text' } },
  { category: 'Filiación', target: 'patient', field: { key: 'fecha_nac', label: 'Fecha de nacimiento', type: 'date' } },
  { category: 'Filiación', target: 'patient', field: { key: 'sexo', label: 'Sexo', type: 'radio', options: ['M', 'F', 'Otro'] } },
  { category: 'Filiación', target: 'patient', field: { key: 'etnia', label: 'Etnia', type: 'radio', options: ['mestiza', 'blanco', 'afro', 'otra'] } },
  { category: 'Filiación', target: 'patient', field: { key: 'escolaridad_grado', label: 'Escolaridad', type: 'radio', options: ['ninguna', 'básico', 'superior', 'tercer nivel', 'cuarto nivel'] } },
  { category: 'Filiación', target: 'patient', field: { key: 'condicion_socioeconomica', label: 'Condición socioeconómica', type: 'radio', options: ['alto', 'medio', 'bajo'] } },
  // §2 Antecedentes (paciente)
  { category: 'Antecedentes', target: 'patient', field: { key: 'antecedentes_personales_presente', label: '¿Antecedentes personales?', type: 'radio', options: SI_NO } },
  { category: 'Antecedentes', target: 'patient', field: { key: 'antecedentes_personales', label: 'Detalle antecedentes personales', type: 'textarea' } },
  { category: 'Antecedentes', target: 'patient', field: { key: 'antecedentes_familiares_presente', label: '¿Antecedentes familiares?', type: 'radio', options: SI_NO } },
  { category: 'Antecedentes', target: 'patient', field: { key: 'antecedentes_familiares', label: 'Detalle antecedentes familiares', type: 'textarea' } },
  // §3 Anamnesis (episodio)
  ...([
  { key: 'motivo_consulta', label: 'Motivo de consulta', type: 'textarea' },
  { key: 'tiempo_evolucion', label: 'Tiempo de evolución', type: 'text', placeholder: 'días, semanas, meses, años' },
  { key: 'curso', label: 'Curso', type: 'radio', options: ['progresivo', 'regresivo', 'continuo', 'intermitente'] },
  { key: 'sintomas_presente', label: '¿Presenta síntomas?', type: 'radio', options: SI_NO },
  { key: 'picor', label: 'Picor', type: 'radio', options: ['leve', 'moderado', 'severo'] },
  { key: 'dolor', label: 'Dolor', type: 'radio', options: ['leve', 'moderado', 'severo'] },
  { key: 'causa_aparente_presente', label: '¿Causa aparente?', type: 'radio', options: SI_NO },
  { key: 'causa_aparente', label: 'Detalle causa aparente', type: 'text' },
  { key: 'patologia_asociada_presente', label: '¿Patología asociada / RAS?', type: 'radio', options: SI_NO },
  { key: 'patologia_asociada', label: 'Detalle patología asociada', type: 'text' },
  { key: 'tratamientos_previos_presente', label: '¿Tratamientos previos?', type: 'radio', options: SI_NO },
  { key: 'tratamientos_previos', label: 'Detalle tratamientos previos', type: 'text' },
  { key: 'anamnesis', label: 'Anamnesis (notas)', type: 'textarea' },
  ] as BotFormField[]).map(field => ({ category: 'Anamnesis', target: 'episode' as const, field })),
  // BLINK — cribado de malignidad (episodio), antes del examen físico.
  // `blink_total` y `blink_resultado` se autocalculan al enviar el formulario.
  ...([
  { key: 'blink_benigna', label: 'B — ¿La lesión se reconoce de inmediato como benigna?', type: 'radio', options: SI_NO },
  { key: 'blink_lonely', label: 'L — ¿Es la lesión solitaria de su tipo ("patito feo")?', type: 'radio', options: SI_NO },
  { key: 'blink_irregular', label: 'I — ¿Pigmentación asimétrica o ≥1 color?', type: 'radio', options: SI_NO },
  { key: 'blink_nervios_cambios', label: 'N/C — ¿Paciente nervioso por cáncer o lesión cambiante?', type: 'radio', options: SI_NO },
  { key: 'blink_known_clues', label: 'K — ¿≥1 pista dermatoscópica de malignidad?', type: 'radio', options: SI_NO },
  ] as BotFormField[]).map(field => ({ category: 'BLINK', target: 'episode' as const, field })),
  // §4 Examen físico (episodio)
  ...([
  // §4.1 Lesión elemental
  { key: 'lesion_macula', label: 'Lesión: Mácula', type: 'radio', options: SI_NO },
  { key: 'lesion_papula', label: 'Lesión: Pápula', type: 'radio', options: SI_NO },
  { key: 'lesion_placa', label: 'Lesión: Placa', type: 'radio', options: SI_NO },
  { key: 'lesion_vesicula', label: 'Lesión: Vesícula', type: 'radio', options: SI_NO },
  { key: 'lesion_ampolla', label: 'Lesión: Ampolla', type: 'radio', options: SI_NO },
  { key: 'lesion_tumor', label: 'Lesión: Tumor', type: 'radio', options: SI_NO },
  { key: 'lesion_nodulo', label: 'Lesión: Nódulo', type: 'radio', options: SI_NO },
  { key: 'lesion_ulcera', label: 'Lesión: Úlcera', type: 'radio', options: SI_NO },
  { key: 'lesion_otra', label: 'Lesión: Otra', type: 'text' },
  // §4.2 Características
  { key: 'caract_eritema', label: 'Caract.: Eritema', type: 'text' },
  { key: 'caract_descamacion', label: 'Caract.: Descamación', type: 'text' },
  { key: 'caract_exudacion', label: 'Caract.: Exudación', type: 'text' },
  { key: 'caract_liquenificacion', label: 'Caract.: Liquenificación', type: 'text' },
  { key: 'caract_otra', label: 'Caract.: Otra', type: 'text' },
  // §4.3 Topografía
  { key: 'topo_unica', label: 'Topo.: Única', type: 'radio', options: SI_NO },
  { key: 'topo_multiples', label: 'Topo.: Múltiples', type: 'radio', options: SI_NO },
  { key: 'topo_bilateral', label: 'Topo.: Bilateral', type: 'radio', options: SI_NO },
  { key: 'topo_simetrico', label: 'Topo.: Simétrico', type: 'radio', options: SI_NO },
  { key: 'topo_confluente', label: 'Topo.: Confluente', type: 'radio', options: SI_NO },
  { key: 'topo_agrupadas', label: 'Topo.: Agrupadas', type: 'radio', options: SI_NO },
  { key: 'topo_circular', label: 'Topo.: Circular', type: 'radio', options: SI_NO },
  { key: 'topo_lineal', label: 'Topo.: Lineal', type: 'radio', options: SI_NO },
  { key: 'topo_borde', label: 'Topo.: Borde', type: 'radio', options: SI_NO },
  { key: 'topo_otra', label: 'Topo.: Otra', type: 'text' },
  // §4.4 Gravedad
  { key: 'gravedad_extension', label: 'Gravedad: Extensión (0-3)', type: 'radio', options: ['0', '1', '2', '3'] },
  { key: 'gravedad_intensidad', label: 'Gravedad: Intensidad (0-3)', type: 'radio', options: ['0', '1', '2', '3'] },
  { key: 'gravedad_funcionalidad', label: 'Gravedad: Funcionalidad (0-3)', type: 'radio', options: ['0', '1', '2', '3'] },
  // §4.5 Patrón
  { key: 'patron_inflam_epidermica', label: 'Patrón: Inflam. epidérmica', type: 'radio', options: SI_NO },
  { key: 'patron_inflam_dermica', label: 'Patrón: Inflam. dérmica', type: 'radio', options: SI_NO },
  { key: 'patron_necrosis', label: 'Patrón: Necrosis', type: 'radio', options: SI_NO },
  { key: 'patron_tumor', label: 'Patrón: Tumor', type: 'radio', options: SI_NO },
  { key: 'patron_color', label: 'Patrón: Color', type: 'radio', options: SI_NO },
  { key: 'notas_examen', label: 'Notas del examen', type: 'textarea' },
  // §4.6 Regiones afectadas — mapa corporal (CSV de claves de región).
  { key: 'regiones_afectadas', label: 'Regiones afectadas', type: 'body_map' },
  // §4.7 Imágenes de la lesión — subida de fotos (CSV de attachment ids).
  { key: 'imagenes_lesion', label: 'Imágenes de la lesión', type: 'image_upload', multiple: true },
  ] as BotFormField[]).map(field => ({ category: 'Examen físico', target: 'episode' as const, field })),
  // §5 Diagnóstico (episodio)
  ...([
  { key: 'diagnostico', label: 'Diagnóstico (CIE-10)', type: 'icd_search' },
  { key: 'diagnostico_letra', label: 'Semáforo A/B/C', type: 'radio', options: ['A', 'B', 'C'] },
  ] as BotFormField[]).map(field => ({ category: 'Diagnóstico', target: 'episode' as const, field })),
  // §6 Estudios (episodio)
  ...([
  { key: 'estudios_complementarios_presente', label: '¿Estudios complementarios?', type: 'radio', options: SI_NO },
  { key: 'estudios_complementarios_resumen', label: 'Resumen de estudios', type: 'textarea' },
  ] as BotFormField[]).map(field => ({ category: 'Estudios', target: 'episode' as const, field })),
  // §7 Tratamiento y plan (episodio)
  ...([
  { key: 'tratamiento_resumen', label: 'Tratamiento', type: 'textarea' },
  { key: 'plan', label: 'Plan', type: 'textarea' },
  { key: 'proximo_control_fecha', label: 'Próximo control', type: 'date' },
  { key: 'proximo_control_motivo', label: 'Motivo del próximo control', type: 'text' },
  ] as BotFormField[]).map(field => ({ category: 'Tratamiento', target: 'episode' as const, field })),
  // §8 Imágenes de consentimiento (paciente)
  { category: 'Consentimiento', target: 'patient', field: { key: 'imagen_consentimiento', label: 'Imagen del consentimiento', type: 'image_upload' } },
];

/** La ficha se agrupa por sección/subsección: un formulario por grupo. */
const byKey: Record<string, FichaFieldDef> =
  Object.fromEntries(FICHA_FIELD_DEFS.map(d => [d.field.key as string, d]));

// Un grupo = un ítem numerado de la ficha (1.1, 1.2, … 3.1, 3.2 …),
// no la sección entera. La categoría (§) sigue agrupando el riel.
const FICHA_GROUP_SPEC: { id: string; label: string; keys: string[] }[] = [
  { id: 'g_1_1', label: '1.1 Datos de contacto',     keys: ['direccion','telefono','sector_ciudad','ocupacion','email'] },
  { id: 'g_1_2', label: '1.2 Fecha de nacimiento',   keys: ['fecha_nac'] },
  { id: 'g_1_3', label: '1.3 Sexo',                  keys: ['sexo'] },
  { id: 'g_1_4', label: '1.4 Etnia',                 keys: ['etnia'] },
  { id: 'g_1_5', label: '1.5 Escolaridad',           keys: ['escolaridad_grado'] },
  { id: 'g_1_6', label: '1.6 Condición socioeconómica', keys: ['condicion_socioeconomica'] },
  { id: 'g_2_1', label: '2.1 Antecedentes personales',  keys: ['antecedentes_personales_presente','antecedentes_personales'] },
  { id: 'g_2_2', label: '2.2 Antecedentes familiares',  keys: ['antecedentes_familiares_presente','antecedentes_familiares'] },
  { id: 'g_3_1', label: '3.1 Motivo de consulta',     keys: ['motivo_consulta','anamnesis'] },
  { id: 'g_3_2', label: '3.2 Tiempo de evolución',    keys: ['tiempo_evolucion'] },
  { id: 'g_3_3', label: '3.3 Curso',                  keys: ['curso'] },
  { id: 'g_3_4', label: '3.4 Síntomas',               keys: ['sintomas_presente','picor','dolor'] },
  { id: 'g_3_5', label: '3.5 Causa aparente',         keys: ['causa_aparente_presente','causa_aparente'] },
  { id: 'g_3_6', label: '3.6 Patología asociada / RAS', keys: ['patologia_asociada_presente','patologia_asociada'] },
  { id: 'g_3_7', label: '3.7 Tratamientos previos',   keys: ['tratamientos_previos_presente','tratamientos_previos'] },
  { id: 'g_blink', label: 'BLINK',                    keys: ['blink_benigna','blink_lonely','blink_irregular','blink_nervios_cambios','blink_known_clues'] },
  { id: 'g_4_1', label: '4.1 Lesión elemental',       keys: ['lesion_macula','lesion_papula','lesion_placa','lesion_vesicula','lesion_ampolla','lesion_tumor','lesion_nodulo','lesion_ulcera','lesion_otra'] },
  { id: 'g_4_2', label: '4.2 Características',         keys: ['caract_eritema','caract_descamacion','caract_exudacion','caract_liquenificacion','caract_otra'] },
  { id: 'g_4_3', label: '4.3 Topografía',             keys: ['topo_unica','topo_multiples','topo_bilateral','topo_simetrico','topo_confluente','topo_agrupadas','topo_circular','topo_lineal','topo_borde','topo_otra'] },
  { id: 'g_4_4', label: '4.4 Gravedad',               keys: ['gravedad_extension','gravedad_intensidad','gravedad_funcionalidad'] },
  { id: 'g_4_5', label: '4.5 Patrón',                 keys: ['patron_inflam_epidermica','patron_inflam_dermica','patron_necrosis','patron_tumor','patron_color','notas_examen'] },
  { id: 'g_4_6', label: '4.6 Regiones afectadas',     keys: ['regiones_afectadas'] },
  { id: 'g_4_7', label: '4.7 Imágenes Lesión',        keys: ['imagenes_lesion'] },
  { id: 'g_5',   label: '5 Diagnóstico',              keys: ['diagnostico','diagnostico_letra'] },
  { id: 'g_6',   label: '6 Estudios complementarios', keys: ['estudios_complementarios_presente','estudios_complementarios_resumen'] },
  { id: 'g_7',   label: '7 Tratamiento y plan',       keys: ['tratamiento_resumen','plan','proximo_control_fecha','proximo_control_motivo'] },
  { id: 'g_8',   label: '8 Imágenes Consentimiento',  keys: ['imagen_consentimiento'] },
];

export const FICHA_GROUPS: FichaGroup[] = FICHA_GROUP_SPEC.map(g => ({
  id: g.id,
  label: g.label,
  category: byKey[g.keys[0]].category,
  target: byKey[g.keys[0]].target,
  fields: g.keys.map(k => byKey[k].field),
}));

// ── Coerción de campos select/radio a sus opciones válidas ───────────────────
// El LLM, al extraer datos de texto libre, produce valores en lenguaje natural
// ("hombre", "negro") que no coinciden con las opciones del select; la BD los
// rechaza (CHECK → "Validación fallida"). Normalizamos contra las opciones de la
// ficha + sinónimos; si no se puede mapear, se descarta el campo (no se fuerza
// un valor inválido ni se rompe el guardado del resto).

function normVal(s: any): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const SELECT_OPTIONS: Record<string, string[]> = {};
const BOOL_FIELDS = new Set<string>();
for (const d of FICHA_FIELD_DEFS) {
  const f = d.field;
  if (f.type !== 'radio' || !f.key || !Array.isArray(f.options) || !f.options.length) continue;
  if (typeof f.options[0] === 'object') BOOL_FIELDS.add(f.key);      // Sí/No (boolean)
  else SELECT_OPTIONS[f.key] = f.options as string[];
}

// Sinónimos (normalizados, sin acentos) → opción canónica, por campo.
const SYNONYMS: Record<string, Record<string, string>> = {
  sexo: { m: 'M', masculino: 'M', hombre: 'M', varon: 'M', masc: 'M', male: 'M', h: 'M',
          f: 'F', femenino: 'F', mujer: 'F', fem: 'F', female: 'F',
          otro: 'Otro', otra: 'Otro', x: 'Otro', 'no binario': 'Otro', nb: 'Otro', intersex: 'Otro' },
  etnia: { afro: 'afro', afrodescendiente: 'afro', negro: 'afro', negra: 'afro', moreno: 'afro', morena: 'afro', black: 'afro', afroamericano: 'afro', afroamericana: 'afro',
           blanco: 'blanco', blanca: 'blanco', caucasico: 'blanco', caucasica: 'blanco', white: 'blanco',
           mestizo: 'mestiza', mestiza: 'mestiza',
           otra: 'otra', otro: 'otra', indigena: 'otra', montubio: 'otra', montubia: 'otra', asiatico: 'otra', asiatica: 'otra', oriental: 'otra' },
  escolaridad_grado: { ninguna: 'ninguna', ninguno: 'ninguna', analfabeto: 'ninguna', 'sin estudios': 'ninguna', 'sin instruccion': 'ninguna',
                       basico: 'básico', basica: 'básico', primaria: 'básico', secundaria: 'básico', escuela: 'básico', colegio: 'básico', bachiller: 'básico', bachillerato: 'básico',
                       superior: 'superior',
                       'tercer nivel': 'tercer nivel', universitario: 'tercer nivel', universitaria: 'tercer nivel', universidad: 'tercer nivel', licenciatura: 'tercer nivel', grado: 'tercer nivel',
                       'cuarto nivel': 'cuarto nivel', postgrado: 'cuarto nivel', posgrado: 'cuarto nivel', maestria: 'cuarto nivel', master: 'cuarto nivel', doctorado: 'cuarto nivel', phd: 'cuarto nivel' },
  condicion_socioeconomica: { alto: 'alto', alta: 'alto', medio: 'medio', media: 'medio', bajo: 'bajo', baja: 'bajo' },
  picor: { leve: 'leve', moderado: 'moderado', moderada: 'moderado', severo: 'severo', severa: 'severo', grave: 'severo', intenso: 'severo' },
  dolor: { leve: 'leve', moderado: 'moderado', moderada: 'moderado', severo: 'severo', severa: 'severo', grave: 'severo', intenso: 'severo' },
  curso: { progresivo: 'progresivo', regresivo: 'regresivo', continuo: 'continuo', constante: 'continuo', intermitente: 'intermitente', fluctuante: 'intermitente' },
};

/** Normaliza el valor de un campo select/radio a su opción válida, o `undefined`
 *  si no se puede mapear (para descartarlo en vez de fallar el guardado). */
export function coerceFichaValue(key: string, value: any): any {
  if (BOOL_FIELDS.has(key)) {
    if (value === true || value === false) return value;
    const n = normVal(value);
    if (['si', 'sí', 'true', '1', 'y', 'yes'].includes(n)) return true;
    if (['no', 'false', '0', 'n'].includes(n)) return false;
    return undefined;
  }
  const opts = SELECT_OPTIONS[key];
  if (!opts) return value;                                  // no es select → tal cual
  const n = normVal(value);
  if (!n) return undefined;
  const exact = opts.find(o => normVal(o) === n);
  if (exact) return exact;
  const syn = SYNONYMS[key]?.[n];
  if (syn) return syn;
  const partial = opts.find(o => { const no = normVal(o); return no === n || no.startsWith(n) || n.startsWith(no); });
  if (partial) return partial;
  return undefined;                                         // no mapeable → descartar
}

/** Coerciona los campos select/radio de un patch a sus opciones válidas; los que
 *  no mapean se omiten (evita "Validación fallida" sin perder los demás campos). */
export function coercePatch(data: Record<string, any>): Record<string, any> {
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SELECT_OPTIONS[k] || BOOL_FIELDS.has(k)) {
      const c = coerceFichaValue(k, v);
      if (c !== undefined) out[k] = c;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const FICHA_FIRST_GROUP = FICHA_GROUPS[0].id;

/** The atomic BotForm for one ficha group (one form per bookmark). */
export function fichaGroupForm(id: string): BotForm | null {
  const g = FICHA_GROUPS.find(x => x.id === id);
  if (!g) return null;
  return {
    id: 'ficha_grp_' + g.id,
    title: g.label,
    submit_mode: 'structured',
    submit_label: 'Guardar',
    fields: g.fields,
    actions: [{ label: 'Omitir', send: 'omitir ficha' }],
  };
}

/**
 * Same as fichaGroupForm, but pre-filled with the field's current value from
 * the target entity (patient or episode) so revisiting a bookmark shows what
 * was already entered.
 */
export async function fichaGroupFormFilled(
  id: string, mcp: TodoErpMcpClient, session: BotSession,
): Promise<BotForm | null> {
  return fichaGroupFormFilledFor(id, mcp, {
    patientId: session.active_patient_id, episodeId: session.active_episode_id,
  });
}

/** El paciente y el episodio de una ficha, sin pasar por la sesión del chat. */
export interface FichaTarget {
  patientId?: string | null;
  episodeId?: string | null;
}

/**
 * Igual que `fichaGroupFormFilled` pero contra ids explícitos. Es la versión que
 * usa el portal de revisión: ahí se abre una ficha cualquiera por id, sin sesión
 * de chat detrás y sin intención de llenarla.
 */
export async function fichaGroupFormFilledFor(
  id: string, mcp: TodoErpMcpClient, target: FichaTarget,
): Promise<BotForm | null> {
  const form = fichaGroupForm(id);
  const g = FICHA_GROUPS.find(x => x.id === id);
  if (!form || !g) return form;
  const entityId = g.target === 'patient' ? target.patientId : target.episodeId;
  if (!entityId) return form;
  try {
    const r = await mcp.call('entities.get', { id: entityId });
    const data = ((r as any)?.data?.data) || {};
    const values: Record<string, unknown> = {};
    for (const f of g.fields) {
      if (f.key && data[f.key] !== undefined && data[f.key] !== null && data[f.key] !== '') {
        values[f.key] = data[f.key];
      }
    }
    if (Object.keys(values).length) form.values = values;
  } catch { /* no prefill */ }
  return form;
}

/** The group shown after `id` in ficha order (or null if it was the last). */
export function nextFichaGroupId(id: string): string | null {
  const i = FICHA_GROUPS.findIndex(g => g.id === id);
  return i >= 0 && i < FICHA_GROUPS.length - 1 ? FICHA_GROUPS[i + 1].id : null;
}

/**
 * `done` y `conDato` responden preguntas distintas y no hay que confundirlas:
 *
 *   done    — ¿está contestada la pregunta ANCLA del grupo (su primer campo)? Es lo
 *             que usa el flujo del chat para decidir qué preguntar a continuación.
 *   conDato — ¿el grupo tiene ALGO cargado? Es lo que muestra el portal de revisión:
 *             un grupo con el detalle lleno pero sin su booleano ancla (típico de lo
 *             importado de DrPro) no puede leerse como vacío, o parece que se perdió
 *             información que en realidad está ahí.
 */
export interface FichaBookmark { id: string; label: string; category: string; done: boolean; conDato: boolean; }

/**
 * The bookmark rail: every ficha group + whether its field actually holds a
 * value on the target entity (patient or episode), regardless of whether it
 * was submitted in this session.
 */
export async function fichaBookmarks(
  mcp: TodoErpMcpClient, session: BotSession,
): Promise<FichaBookmark[]> {
  return fichaBookmarksFor(mcp, {
    patientId: session.active_patient_id, episodeId: session.active_episode_id,
  });
}

/**
 * Igual que `fichaBookmarks` pero contra ids explícitos: el mapa de qué grupos de
 * la ficha tienen dato y cuáles no, para un paciente/episodio cualquiera.
 *
 * Es la respuesta a "qué datos faltan" del portal de revisión, y también sirve para
 * las fichas espejadas de DrPro, que llenan anamnesis/exploración/plan/diagnóstico
 * pero dejan vacíos los grupos dermatológicos (4.x, BLINK) porque el origen no los
 * tiene. Sin este mapa esa ficha parece información perdida en vez de información
 * que nunca existió.
 */
export async function fichaBookmarksFor(
  mcp: TodoErpMcpClient, target: FichaTarget,
): Promise<FichaBookmark[]> {
  const session = {
    active_patient_id: target.patientId ?? null,
    active_episode_id: target.episodeId ?? null,
  } as Pick<BotSession, 'active_patient_id' | 'active_episode_id'>;
  let patientData: Record<string, unknown> = {};
  let episodeData: Record<string, unknown> = {};
  if (session.active_patient_id) {
    try {
      const pr = await mcp.call('entities.get', { id: session.active_patient_id });
      patientData = ((pr as any)?.data?.data) || {};
    } catch { patientData = {}; }
  }
  if (session.active_episode_id) {
    try {
      const er = await mcp.call('entities.get', { id: session.active_episode_id });
      episodeData = ((er as any)?.data?.data) || {};
    } catch { episodeData = {}; }
  }
  // Image-upload groups don't store a field on the entity — they create
  // clinical_image / consent records. Mark them done when such a record
  // exists for the active episode / patient.
  let hasLesionImages = false;
  let hasConsentImages = false;
  if (session.active_episode_id) {
    try {
      const r = await mcp.call('entities.list', {
        type: CLINICAL_IMAGE_ENTITY_ID,
        filter: { episode_id: session.active_episode_id },
        limit: 1,
      });
      hasLesionImages = Array.isArray((r as any)?.data) && (r as any).data.length > 0;
    } catch { /* treat as none */ }
  }
  if (session.active_patient_id) {
    try {
      const r = await mcp.call('entities.list', {
        type: CONSENT_ENTITY_ID,
        filter: { patient_id: session.active_patient_id, tipo: 'imagen_clinica' },
        limit: 1,
      });
      hasConsentImages = Array.isArray((r as any)?.data) && (r as any).data.length > 0;
    } catch { /* treat as none */ }
  }

  const lleno = (v: unknown) => v !== undefined && v !== null && v !== '';

  return FICHA_GROUPS.map(g => {
    // Los grupos de imagen no guardan campo en la entidad: crean registros
    // clinical_image / consent. Para ellos "tener dato" es "existe el registro".
    if (g.id === 'g_4_7') {
      return { id: g.id, label: g.label, category: g.category, done: hasLesionImages, conDato: hasLesionImages };
    }
    if (g.id === 'g_8') {
      return { id: g.id, label: g.label, category: g.category, done: hasConsentImages, conDato: hasConsentImages };
    }
    const src = g.target === 'patient' ? patientData : episodeData;
    const done = lleno(src[g.fields[0].key as string]);
    const conDato = g.fields.some(f => f.key && lleno(src[f.key as string]));
    return { id: g.id, label: g.label, category: g.category, done, conDato };
  });
}

/** Un grupo de la ficha con su formulario ya prellenado y si tiene dato o no. */
export interface FichaGrupoCompleto {
  id: string;
  label: string;
  category: string;
  done: boolean;
  target: string;
  form: BotForm | null;
}

/**
 * La ficha ENTERA de un paciente/episodio: los grupos en orden, cada uno con su
 * formulario prellenado y si tiene dato. Es lo que consume el portal de revisión,
 * donde el médico abre un caso para leerlo y ver qué falta — no para llenarlo.
 *
 * Hace 2 lecturas de entidad y arma los 27 formularios en memoria, en vez de una
 * lectura por grupo: prellenar grupo a grupo con `fichaGroupFormFilledFor` costaría
 * 27 round-trips MCP por ficha abierta.
 */
export async function fichaCompleta(
  mcp: TodoErpMcpClient, target: FichaTarget,
): Promise<{ grupos: FichaGrupoCompleto[]; faltantes: string[]; completos: number; total: number }> {
  let patientData: Record<string, unknown> = {};
  let episodeData: Record<string, unknown> = {};
  if (target.patientId) {
    try {
      const r = await mcp.call('entities.get', { id: target.patientId });
      patientData = ((r as any)?.data?.data) || {};
    } catch { patientData = {}; }
  }
  if (target.episodeId) {
    try {
      const r = await mcp.call('entities.get', { id: target.episodeId });
      episodeData = ((r as any)?.data?.data) || {};
    } catch { episodeData = {}; }
  }

  const marcas = await fichaBookmarksFor(mcp, target);
  // El portal muestra si el grupo TIENE ALGO, no si está contestada su pregunta ancla.
  const conDatoById = new Map(marcas.map(m => [m.id, m.conDato]));

  const grupos = FICHA_GROUPS.map(g => {
    const form = fichaGroupForm(g.id);
    const src = g.target === 'patient' ? patientData : episodeData;
    if (form) {
      const values: Record<string, unknown> = {};
      for (const f of g.fields) {
        const k = f.key as string;
        if (k && src[k] !== undefined && src[k] !== null && src[k] !== '') values[k] = src[k];
      }
      if (Object.keys(values).length) form.values = values;
    }
    return {
      id: g.id, label: g.label, category: g.category, target: g.target,
      done: conDatoById.get(g.id) ?? false, form,
    };
  });

  const faltantes = grupos.filter(g => !g.done).map(g => g.label);
  return { grupos, faltantes, completos: grupos.length - faltantes.length, total: grupos.length };
}

/**
 * Calcula la completitud de la ficha y la GUARDA en el episodio.
 *
 * El portal de casos busca deuda de datos ("los casos a los que les falta la mitad"),
 * y eso hay que filtrarlo en SQL sobre cientos de episodios: calcularlo al vuelo sería
 * 2 lecturas de entidad por caso listado. Por eso el número se materializa en
 * `entity_episode` (medical-seed 009) y el portal filtra y ordena por columna.
 *
 * Vive acá y no en TodoERP porque los 27 grupos son vocabulario clínico y el ERP es
 * genérico: el ERP solo guarda el número que este cálculo produce.
 */
/**
 * Recalcula la completitud tras guardar, sin poder romper el guardado.
 *
 * El % se calcula EN EL MOMENTO DEL GUARDADO y no por lote: así toda ficha nueva
 * nace con su deuda de datos medida y el portal puede buscarla. Un fallo del
 * cálculo se registra pero NO se propaga: es una métrica, y perderla no justifica
 * hacer fallar una escritura clínica que ya se completó.
 */
export async function recalcularTrasGuardar(
  mcp: TodoErpMcpClient, session: BotSession,
): Promise<void> {
  if (!session.active_episode_id) return;
  try {
    await recalcularCompletitud(mcp, {
      patientId: session.active_patient_id, episodeId: session.active_episode_id,
    });
  } catch (err) {
    console.error('[ficha] no se pudo recalcular la completitud:', (err as any)?.message || err);
  }
}

export async function recalcularCompletitud(
  mcp: TodoErpMcpClient, target: FichaTarget,
): Promise<{ pct: number; conDato: number; total: number; faltantes: string[] }> {
  if (!target.episodeId) throw new Error('recalcularCompletitud requiere episodeId');

  const marcas = await fichaBookmarksFor(mcp, target);
  const total = marcas.length;
  const conDato = marcas.filter(m => m.conDato).length;
  const faltantes = marcas.filter(m => !m.conDato).map(m => m.label);
  const pct = total ? Math.round((conDato / total) * 100) : 0;

  // `record_type` es OBLIGATORIO en entities.update; sin él la tool rechaza la
  // escritura. Y el resultado se COMPRUEBA: ignorarlo hacía que el recálculo
  // reportara éxito con los campos en NULL, que es peor que fallar.
  const w: any = await mcp.call('entities.update', {
    id: target.episodeId,
    record_type: 'business',
    data: {
      ficha_completitud: pct,
      ficha_grupos_con_dato: conDato,
      // Se guarda la lista y no solo el número para que el listado pueda decir QUÉ
      // falta sin recalcular la ficha entera en cada fila.
      ficha_faltantes: faltantes.join('; '),
      ficha_calculada_at: new Date().toISOString(),
    },
  });
  if (w?.ok === false || w?.isError) {
    throw new Error(`no se pudo guardar la completitud del episodio ${target.episodeId}: ${w?.error || JSON.stringify(w).slice(0, 160)}`);
  }

  return { pct, conDato, total, faltantes };
}

/**
 * First ficha group still missing a value, so the flow can skip sections that
 * are already complete (e.g. a returning patient with full contact data).
 * Returns null when every group is already filled.
 */
export async function firstIncompleteFichaGroup(
  mcp: TodoErpMcpClient, session: BotSession,
): Promise<string | null> {
  const marks = await fichaBookmarks(mcp, session);
  return marks.find(m => !m.done)?.id ?? null;
}

/**
 * First ficha group strictly after `afterId` that still has no value, so the
 * flow auto-skips sections already complete when advancing — e.g. a shared
 * patient field (fecha de nacimiento) filled from another session.
 * Returns null when nothing after `afterId` is left to fill.
 */
export async function nextIncompleteFichaGroupId(
  afterId: string, mcp: TodoErpMcpClient, session: BotSession,
): Promise<string | null> {
  const marks = await fichaBookmarks(mcp, session);
  const start = marks.findIndex(m => m.id === afterId) + 1;
  for (let i = start; i < marks.length; i++) {
    if (!marks[i].done) return marks[i].id;
  }
  return null;
}

/** Whether a ficha group already holds a value on its target entity. */
export async function fichaGroupIsComplete(
  id: string, mcp: TodoErpMcpClient, session: BotSession,
): Promise<boolean> {
  const marks = await fichaBookmarks(mcp, session);
  return marks.find(m => m.id === id)?.done ?? false;
}

// Key routing for a full-ficha "Guardar": §1–§2 → paciente, resto → episodio.
// Identity fields (nombre/apellidos/cedula) are intentionally excluded.
const FICHA_PATIENT_KEYS = new Set<string>([
  'direccion', 'telefono', 'sector_ciudad', 'ocupacion', 'email', 'edad',
  'sexo', 'etnia', 'etnia_otra', 'escolaridad_anios', 'escolaridad_grado',
  'condicion_socioeconomica', 'antecedentes_personales',
  'antecedentes_personales_presente', 'antecedentes_familiares',
  'antecedentes_familiares_presente',
]);
const FICHA_EPISODE_KEYS = new Set<string>([
  ...FICHA_GROUPS.flatMap(g =>
    g.fields
      // image_upload keys are not entity columns — they drive clinical_image
      // / consent creation, not entities.update. Exclude from save routing.
      .filter(f => f.type !== 'image_upload')
      .map(f => f.key).filter((k): k is string => !!k)),
  'gravedad_total', 'ficha_num', 'examinador_nombre', 'regiones_afectadas',
  'blink_total', 'blink_resultado',
]);

/** Traffic-light label for a §5 diagnosis letter. */
const DX_COLOR: Record<string, string> = { A: 'verde', B: 'amarillo', C: 'rojo' };

/** A structured form submission from the frontend (ficha sections). */
export interface FormSubmission {
  form_id: string;
  data: Record<string, unknown>;
  /** ficha_save only — the episode being saved (paginator may differ from active). */
  episode_id?: string;
}

interface Ctx {
  session: BotSession;
  message: string;
  mcp: TodoErpMcpClient;
  formSubmission?: FormSubmission;
}

type FlowMode = 'unset' | 'general' | 'patient' | 'patient_info';
function getMode(s: BotSession): FlowMode {
  return ((s.extracted_slots as any)?.mode as FlowMode) || 'unset';
}
function setSlot(s: BotSession, key: string, value: unknown) {
  s.extracted_slots = { ...(s.extracted_slots || {}), [key]: value };
}
function clearSlot(s: BotSession, key: string) {
  const slots = { ...(s.extracted_slots || {}) };
  delete slots[key];
  s.extracted_slots = slots;
}

function appendAndSave(s: BotSession, userMsg: string, botMsg: string, mcp: TodoErpMcpClient) {
  s.turns = [
    ...s.turns,
    { role: 'user', content: userMsg },
    { role: 'assistant', content: botMsg },
  ];
  return saveSession(mcp, s);
}

/** Parse the CSV produced by the image_upload field into attachment ids. */
function parseAttachmentCsv(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Submit handler for the §4.7 (Imágenes Lesión) and §8 (Imágenes
 * Consentimiento) ficha groups.
 *
 * §4.7 — for each uploaded attachment: inspect via cepi-isic (quality + face).
 *   Inadequate images are skipped (reported in chat); images with a face are
 *   flagged `privada`. Adequate images become clinical_image records
 *   (embedding_status:'pending', linked to episode + patient). The
 *   clinicalImageProcessor worker does ISIC after.
 * §8 — each uploaded attachment becomes a consent record (tipo:
 *   'imagen_clinica') linked to the patient. No quality/face/ISIC checks.
 *
 * Like every other ficha group, the records are written directly on submit:
 * sending the ficha form is itself the user's explicit action, so no extra
 * sí/no confirmation gate is interposed.
 */
/**
 * Coerciones y campos derivados de un grupo de la ficha, **mutando `data` en sitio**.
 *
 * Vive aparte del handler del chat porque el portal de casos guarda los mismos grupos
 * sin sesión de chat detrás (PAPER §22). Dos caminos de escritura distintos sobre una
 * ficha clínica es como se termina con un BLINK calculado en un lado y no en el otro.
 */
export async function prepararDatosGrupo(
  gid: string,
  data: Record<string, unknown>,
  mcp: TodoErpMcpClient,
  episodeId?: string | null,
): Promise<Record<string, unknown>> {
  const grp = FICHA_GROUPS.find(g => g.id === gid);
  const isPatient = grp?.target === 'patient';

  // Columna numérica — el input llega como texto.
  if (data.edad != null && data.edad !== '') data.edad = Number(data.edad);
  if (isPatient) return data;

  const gKeys = ['gravedad_extension', 'gravedad_intensidad', 'gravedad_funcionalidad'];
  for (const k of gKeys) {
    if (data[k] != null && data[k] !== '') data[k] = Number(data[k]);
  }
  // Los formularios son atómicos (un campo cada uno), así que un envío nunca trae las
  // tres gravedades: el total se re-deriva leyendo lo que ya hay en el episodio.
  if (gKeys.some(k => data[k] != null) && episodeId) {
    try {
      const er = await mcp.call('entities.get', { id: episodeId });
      const cur = ((er as any)?.data?.data) || {};
      data.gravedad_total = gKeys.reduce((a, k) => a + (Number(data[k] ?? cur[k]) || 0), 0);
    } catch { /* sin total */ }
  }
  // BLINK — la sección entera es un solo formulario, así que este envío trae las 5
  // respuestas; el puntaje (L+I+N/C+K, 1 pt c/u) y el resultado se autocalculan.
  if (gid === 'g_blink') {
    const scoreKeys = ['blink_lonely', 'blink_irregular', 'blink_nervios_cambios', 'blink_known_clues'];
    const total = scoreKeys.reduce((a, k) => a + (data[k] === true ? 1 : 0), 0);
    data.blink_total = total;
    data.blink_resultado = data.blink_benigna === true
      ? 'Benigna evidente — no precisa más estudios'
      : total >= 2
        ? `Sugiere malignidad (${total}/4) — biopsia`
        : `Sugiere benignidad (${total}/4)`;
  }
  return data;
}

/**
 * Guarda un grupo de la ficha contra ids explícitos, sin sesión de chat.
 * Es el camino de edición del portal de casos: mismas coerciones y derivados que el
 * chat, y recálculo de la completitud al terminar.
 */
/**
 * Guarda la ficha ENTERA de una vez, repartiendo cada clave a su entidad: §1-§2
 * son del paciente, §3 en adelante del episodio.
 *
 * Es lo que hace el botón «Guardar» de los formatos documentales del portal y el
 * del visor de telemedicina. Se guarda al pulsar, nunca campo a campo mientras se
 * escribe: en un documento de una página el usuario corrige varias casillas antes
 * de dar por buena la versión, y un autoguardado dejaría en la historia clínica
 * estados intermedios que nadie firmó.
 *
 * Un campo vacío NO borra: `entities.update` mezcla clave a clave, así que una
 * cadena vacía pisaría el valor guardado. Misma guarda que los formularios de grupo.
 */
export async function guardarFichaCompleta(
  mcp: TodoErpMcpClient,
  target: FichaTarget,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; errores: string[]; camposPaciente: number; camposEpisodio: number; completitud: number | null }> {
  const patientData: Record<string, unknown> = {};
  const episodeData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === '' || v === null || v === undefined) continue;
    if (FICHA_PATIENT_KEYS.has(k)) patientData[k] = v;
    else if (FICHA_EPISODE_KEYS.has(k)) episodeData[k] = v;
    // Lo que no pertenece a ninguna de las dos se descarta en silencio: los
    // formatos documentales llevan casillas propias (unicódigo, signos vitales)
    // que no son campos de la ficha.
  }

  const errores: string[] = [];
  if (target.patientId && Object.keys(patientData).length) {
    const r: any = await mcp.call('entities.update', {
      id: target.patientId, record_type: 'business', data: coercePatch(patientData),
    });
    if (r?.ok === false || r?.isError) errores.push(`paciente: ${r?.error || 'error'}`);
  }
  if (target.episodeId && Object.keys(episodeData).length) {
    const r: any = await mcp.call('entities.update', {
      id: target.episodeId, record_type: 'business', data: coercePatch(episodeData),
    });
    if (r?.ok === false || r?.isError) errores.push(`episodio: ${r?.error || 'error'}`);
  }

  let completitud: number | null = null;
  if (target.episodeId) {
    try {
      completitud = (await recalcularCompletitud(mcp, target)).pct;
    } catch (err) {
      console.error('[ficha] guardado ok pero falló el recálculo:', (err as any)?.message || err);
    }
  }

  return {
    ok: errores.length === 0,
    errores,
    camposPaciente: Object.keys(patientData).length,
    camposEpisodio: Object.keys(episodeData).length,
    completitud,
  };
}

export async function guardarGrupoFicha(
  mcp: TodoErpMcpClient,
  args: { groupId: string; data: Record<string, unknown>; patientId?: string | null; episodeId?: string | null },
): Promise<{ ok: true; target: string; targetId: string; completitud: number | null }> {
  const grp = FICHA_GROUPS.find(g => g.id === args.groupId);
  if (!grp) throw new Error(`grupo de ficha desconocido: ${args.groupId}`);
  // Los grupos de imagen crean registros clinical_image / consent, no escriben campos:
  // su alta va por el flujo de subida, no por acá.
  if (args.groupId === 'g_4_7' || args.groupId === 'g_8') {
    throw new Error(`el grupo ${grp.label} se completa subiendo imágenes, no con este endpoint`);
  }

  const isPatient = grp.target === 'patient';
  const targetId = isPatient ? args.patientId : args.episodeId;
  if (!targetId) throw new Error(`falta ${isPatient ? 'patient_id' : 'episode_id'} para guardar ${grp.label}`);

  // Solo se aceptan las claves QUE PERTENECEN al grupo: sin esto, un payload podría
  // escribir cualquier campo de la entidad desde un formulario que no lo declara.
  const permitidas = new Set(grp.fields.map(f => f.key).filter(Boolean) as string[]);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.data || {})) {
    if (permitidas.has(k)) data[k] = v;
  }
  if (!Object.keys(data).length) throw new Error(`ningún campo de ${grp.label} en el payload`);

  await prepararDatosGrupo(args.groupId, data, mcp, args.episodeId);
  // coercePatch alinea los select/radio con sus opciones válidas antes de persistir.
  const limpio = coercePatch(data);

  const upd: any = await mcp.call('entities.update', { id: targetId, record_type: 'business', data: limpio });
  if (upd?.ok === false || upd?.isError) {
    throw new Error(`no se pudo guardar ${grp.label}: ${upd?.error || JSON.stringify(upd).slice(0, 160)}`);
  }

  let completitud: number | null = null;
  if (args.episodeId) {
    try {
      const r = await recalcularCompletitud(mcp, { patientId: args.patientId, episodeId: args.episodeId });
      completitud = r.pct;
    } catch (err) {
      console.error('[ficha] guardado ok pero falló el recálculo:', (err as any)?.message || err);
    }
  }
  return { ok: true, target: grp.target, targetId, completitud };
}

async function handleImageGroupSubmit(
  gid: 'g_4_7' | 'g_8',
  data: Record<string, unknown>,
  session: BotSession,
  mcp: TodoErpMcpClient,
  message: string,
): Promise<FlowResponse> {
  const key = gid === 'g_4_7' ? 'imagenes_lesion' : 'imagen_consentimiento';
  const attachmentIds = parseAttachmentCsv(data[key]);
  const grp = FICHA_GROUPS.find(g => g.id === gid);
  const summary = `📋 ${grp?.label || ''}`;

  if (!attachmentIds.length) {
    const text = 'No subiste ninguna imagen. Elegí al menos un archivo y volvé a guardar.';
    await appendAndSave(session, summary, text, mcp);
    return { text, form: fichaGroupForm(gid), bookmarks: await fichaBookmarks(mcp, session) };
  }

  // Build the create payloads (per group), collecting per-image chat notes.
  const notes: string[] = [];
  const creates: Array<{ title: string; data: Record<string, unknown> }> = [];
  let entityId = '';

  if (gid === 'g_8') {
    if (!session.active_patient_id) {
      const text = 'Necesito un paciente activo para registrar el consentimiento.';
      await appendAndSave(session, summary, text, mcp);
      return { text };
    }
    entityId = CONSENT_ENTITY_ID;
    for (const aid of attachmentIds) {
      creates.push({
        title: `consent_imagen_${aid.slice(0, 8)}`,
        data: {
          [`${PATIENT_ENTITY_ID}:patient_id`]: session.active_patient_id,
          tipo: 'imagen_clinica',
          version: 'imagen-subida',
          documento: aid,
          firmado_at: new Date().toISOString().slice(0, 10),
        },
      });
    }
  } else {
    // §4.7 — lesión: inspect each image, then keep the adequate ones.
    if (!session.active_episode_id || !session.active_patient_id) {
      const text = 'Necesito un paciente y un episodio activos para registrar imágenes de la lesión.';
      await appendAndSave(session, summary, text, mcp);
      return { text };
    }
    entityId = CLINICAL_IMAGE_ENTITY_ID;
    for (const aid of attachmentIds) {
      const r = await inspectAttachment(aid, mcp);
      const short = aid.slice(0, 8);
      if (!r.adequate) {
        const why = r.reasons.length ? r.reasons.join('; ') : (r.error || 'no apta');
        notes.push(`  • Imagen ${short}… descartada — ${why}. Subí otra.`);
        continue;
      }
      notes.push(r.has_face
        ? `  • Imagen ${short}… contiene un rostro — la marqué como privada.`
        : `  • Imagen ${short}… apta (${r.width}×${r.height}px).`);
      creates.push({
        title: `clinical_image_${short}`,
        data: {
          [`${EPISODE_ENTITY_ID}:episode_id`]: session.active_episode_id,
          [`${PATIENT_ENTITY_ID}:patient_id`]: session.active_patient_id,
          attachment_id: aid,
          imagen: aid,
          field_key: 'lesion',
          consentimiento_uso_imagen: true,
          embedding_status: 'pending',
          privada: !!r.has_face,
        },
      });
    }
    if (!creates.length) {
      const text = `Ninguna de las imágenes pasó el control de calidad:\n${notes.join('\n')}`;
      await appendAndSave(session, summary, text, mcp);
      return { text, form: fichaGroupForm(gid), bookmarks: await fichaBookmarks(mcp, session) };
    }
  }

  // Write the records directly (no confirmation gate — see header).
  let ok = 0;
  const okIds: string[] = [];
  const errs: string[] = [];
  for (const c of creates) {
    const r = await mcp.call('entities.create', {
      record_type: 'business', entity_id: entityId, title: c.title, data: c.data,
    });
    if ((r as any)?.ok) {
      ok++;
      const id = (r as any)?.data?.id;
      if (typeof id === 'string') okIds.push(id);
    } else {
      errs.push((r as any)?.error || 'error desconocido');
    }
  }

  const head = gid === 'g_8'
    ? `Registré ${ok} imagen(es) de consentimiento ligada(s) al paciente.`
    : `Registré ${ok} imagen(es) clínica(s) ligada(s) al episodio y al paciente. ` +
      `El worker ISIC las clasifica en unos segundos — te muestro el resultado acá apenas termine.`;
  const lines = [
    notes.length ? `Revisé las imágenes:\n${notes.join('\n')}` : '',
    head,
    errs.length ? `⚠️ ${errs.length} no se pudo(eron) guardar: ${errs.join('; ')}.` : '',
  ].filter(Boolean);

  // §4.7 — the frontend polls cepi-isic for exactly these new images and
  // surfaces their classification in the chat once the worker finishes.
  const awaitIsic = gid === 'g_4_7' && okIds.length ? okIds : undefined;

  // Mark the group done and advance to the next incomplete one.
  const doneArr: string[] = ((session.extracted_slots as any)?.ficha_done as string[]) || [];
  if (!doneArr.includes(gid)) doneArr.push(gid);
  setSlot(session, 'ficha_done', doneArr);
  const nid = await nextIncompleteFichaGroupId(gid, mcp, session);
  if (nid) {
    const form = (await fichaGroupFormFilled(nid, mcp, session))!;
    setSlot(session, 'ficha_current', nid);
    const text = `${lines.join('\n\n')}\n\nSiguiente: ${form.title}.`;
    await appendAndSave(session, summary, text, mcp);
    return { text, form, await_isic: awaitIsic, bookmarks: await fichaBookmarks(mcp, session) };
  }
  const text = `${lines.join('\n\n')}\n\nFicha completa. Revisá lo que quieras desde los marcadores.`;
  await appendAndSave(session, summary, text, mcp);
  return { text, form: null, await_isic: awaitIsic, bookmarks: await fichaBookmarks(mcp, session) };
}

/**
 * Returns a response if the V1 flow handled the turn, else null.
 */
export async function handleV1Flow(ctx: Ctx): Promise<FlowResponse | null> {
  const { session, mcp } = ctx;
  const message = ctx.message;
  const trimmed = message.trim();
  const mode = getMode(session);

  // ── Ficha clínica "Guardar" — full ficha edited in the modal viewer ──
  // Routes §1–§2 keys to the patient and §3–§7 keys to the active episode,
  // then refreshes the patient context held in the session.
  if (ctx.formSubmission?.form_id === 'ficha_save') {
    const data = (ctx.formSubmission.data || {}) as Record<string, unknown>;
    const epId = ctx.formSubmission.episode_id || session.active_episode_id;
    // Mismo guardado que usa el botón del portal: una sola implementación del
    // reparto paciente/episodio y de la guarda de campos vacíos.
    const res = await guardarFichaCompleta(mcp, {
      patientId: session.active_patient_id, episodeId: epId,
    }, data);
    const errs = res.errores;
    // Refresh the patient context the session carries for the bot.
    if (session.active_patient_id) {
      try {
        const pr = await mcp.call('entities.get', { id: session.active_patient_id });
        const pd = ((pr as any)?.data?.data) || {};
        setSlot(session, 'patient_context', { id: session.active_patient_id, ...pd });
      } catch { /* keep prior context */ }
    }
    const text = errs.length
      ? `Guardé la ficha con observaciones — ${errs.join('; ')}.`
      : 'Ficha guardada. Los cambios quedaron en el paciente y el episodio.';
    await appendAndSave(session, '📋 Ficha guardada', text, mcp);
    return { text };
  }

  // ── §5 Diagnóstico traffic-light — set A/B/C on the active episode ──
  if (ctx.formSubmission?.form_id === 'set_diagnostico') {
    const letra = String(ctx.formSubmission.data?.diagnostico_letra || '').toUpperCase();
    const epId = ctx.formSubmission.episode_id || session.active_episode_id;
    if (!['A', 'B', 'C'].includes(letra) || !epId) {
      const text = 'No pude registrar el diagnóstico (falta letra o episodio).';
      await appendAndSave(session, 'Diagnóstico', text, mcp);
      return { text };
    }
    const r = await mcp.call('entities.update', {
      id: epId, record_type: 'business', data: { diagnostico_letra: letra },
    });
    const text = (r as any)?.ok
      ? `Diagnóstico del episodio: ${letra} (${DX_COLOR[letra]}).`
      : `No pude registrar el diagnóstico: ${(r as any)?.error || 'error'}.`;
    await appendAndSave(session, `Diagnóstico: ${letra}`, text, mcp);
    return { text };
  }

  // ── mode setters (work in any state) ─────────────────────────────
  if (/^\s*\/?\s*(general|consulta\s+general)\s*$/i.test(trimmed)) {
    setSlot(session, 'mode', 'general');
    clearSlot(session, 'form_state');
    const text = 'Modo consulta general. ¿En qué te ayudo?';
    await appendAndSave(session, message, text, mcp);
    return { text };
  }

  if (mode === 'unset' && /^\s*\/?\s*(informaci[oó]n\s+paciente|info\s+paciente)\s*$/i.test(trimmed)) {
    setSlot(session, 'mode', 'patient_info');
    const text = 'Información de paciente (consulta no presencial). Buscá el paciente.';
    await appendAndSave(session, message, text, mcp);
    return { text, form: PATIENT_SEARCH_FORM };
  }

  if (mode === 'unset' && /^\s*\/?\s*(paciente|atenci[oó]n)\s*$/i.test(trimmed)) {
    setSlot(session, 'mode', 'patient');
    const text = 'Buscar paciente por cédula o nombre, o crea uno nuevo.';
    await appendAndSave(session, message, text, mcp);
    return { text, form: PATIENT_SEARCH_FORM };
  }

  if (mode === 'unset' && /^\s*\/?\s*(nuevo\s+paciente|crear\s+paciente)\s*$/i.test(trimmed)) {
    setSlot(session, 'mode', 'patient');
    const text = 'Completá los datos del nuevo paciente.';
    await appendAndSave(session, message, text, mcp);
    return { text, form: PATIENT_NEW_FORM };
  }

  // ── unset mode: the frontend hardcodes the mode question + buttons in
  //    the welcome screen, so we don't ask it from the bot. We assume
  //    "general" by default and fall through to the rest of the pipeline.
  if (mode === 'unset') {
    setSlot(session, 'mode', 'general');
  }

  // ── patient / patient_info mode without active patient: search/new ───────
  if ((mode === 'patient' || mode === 'patient_info') && !session.active_patient_id) {
    // New-patient form submission: "/nuevo-paciente <cedula> || <nombre> || <apellidos>".
    const npm = trimmed.match(
      /^\/?\s*nuevo-paciente\s+([\s\S]+?)\s*\|\|\s*([\s\S]+?)\s*\|\|\s*([\s\S]+)$/i,
    );
    if (npm) {
      const cedula = npm[1].trim();
      const nombre = npm[2].trim();
      const apellidos = npm[3].trim();
      if (!cedula || !nombre || !apellidos) {
        const text = 'Faltan datos: cédula, nombres y apellidos son obligatorios.';
        await appendAndSave(session, message, text, mcp);
        return { text, form: PATIENT_NEW_FORM };
      }
      // On confirmation the server auto-activates the patient and, in
      // atención mode, opens a new episode + the ficha clínica (§3 form).
      const isAttention = mode === 'patient';
      session.pending_action = {
        summary: `Crear paciente ${nombre} ${apellidos} (cédula ${cedula})`,
        tool: 'entities.create',
        args: {
          record_type: 'business',
          entity_id: PATIENT_ENTITY_ID,
          title: `${nombre} ${apellidos}`.trim(),
          data: { cedula, nombre, apellidos },
        },
        successMessage: isAttention
          ? `Listo, ${nombre} ${apellidos} quedó registrado. Abrimos la consulta — empecemos la ficha clínica:`
          : `Listo, ${nombre} ${apellidos} quedó registrado y es el paciente activo.`,
        createdAt: new Date().toISOString(),
      };
      const userMsg = `Nuevo paciente: ${nombre} ${apellidos} · ${cedula}`;
      const text =
        `Crear paciente:\n  • Cédula: ${cedula}\n  • Nombres: ${nombre}\n` +
        `  • Apellidos: ${apellidos}\n\n¿Confirmas?`;
      await appendAndSave(session, userMsg, text, mcp);
      // The confirmation card already carries ✓/✗ — no duplicate quick replies.
      // Clear the persisted patient_new form (form: null): we're now staging
      // the create and waiting on a sí/no, so the server must stop re-attaching
      // patient_new to the "¿Confirmas?" turn. With the confirm gate ON this is
      // what prevents Telegram from restarting the walk over the confirmation.
      return { text, form: null, pending_action_set: true };
    }

    // Trigger new-patient form
    if (/^\s*\/?\s*(nuevo|nuevo\s+paciente|crear\s+paciente)\s*$/i.test(trimmed)) {
      const text = 'Completá los datos del nuevo paciente.';
      await appendAndSave(session, message, text, mcp);
      return { text, form: PATIENT_NEW_FORM };
    }

    // Otherwise: search
    const r = await mcp.call('entities.list', {
      type: PATIENT_ENTITY_ID,
      search: trimmed,
      limit: 5,
    });
    const list = Array.isArray(r.data) ? r.data : [];
    if (list.length === 0) {
      const text = `Sin coincidencias para "${trimmed}". Probá de nuevo o crea uno.`;
      await appendAndSave(session, message, text, mcp);
      return { text, form: PATIENT_SEARCH_FORM };
    }
    const lines = list.map((p: any, i: number) => {
      const d = p.data || {};
      const name = [d.nombre, d.apellidos].filter(Boolean).join(' ') || p.title || '(sin nombre)';
      const ced = d.cedula ? ` · ${d.cedula}` : '';
      return `${i + 1}. ${name}${ced}`;
    });
    const text = `Resultados:\n${lines.join('\n')}\nElegí uno o "nuevo paciente".`;
    await appendAndSave(session, message, text, mcp);
    return {
      text,
      quick_replies: [
        ...list.map((p: any) => {
          const d = p.data || {};
          const name = [d.nombre, d.apellidos].filter(Boolean).join(' ') || p.title || p.id.slice(0, 8);
          return { label: name, send: `activar paciente ${p.id}` };
        }),
        { label: '+ Nuevo paciente', send: 'nuevo paciente' },
      ],
    };
  }

  // ── patient mode WITH active patient: ficha clínica group flow ──
  // The ficha is walked as atomic groups: one structured BotForm per group,
  // each group a bookmark in the chat's left rail. Submitting a group form
  // merges its data into the active episode via entities.update.
  if ((session.extracted_slots as any)?.form_state?.kind === 'ficha') {
    const sub = ctx.formSubmission;
    const current: string =
      ((session.extracted_slots as any)?.ficha_current as string) || FICHA_GROUPS[0].id;

    // Jump to a group via the bookmark rail.
    if (sub?.form_id === 'ficha_goto') {
      const group = String(sub.data?.group);
      const form = await fichaGroupFormFilled(group, mcp, session);
      if (form) {
        setSlot(session, 'ficha_current', group);
        await appendAndSave(session, message, `${form.title}:`, mcp);
        return { text: `${form.title}:`, form, bookmarks: await fichaBookmarks(mcp, session) };
      }
    }

    // "Omitir" — skip the current form, move to the next one (nothing saved).
    if (/^\s*\/?\s*omitir(\s+ficha)?\s*$/i.test(trimmed)) {
      const nid = await nextIncompleteFichaGroupId(current, mcp, session);
      if (nid) {
        const form = (await fichaGroupFormFilled(nid, mcp, session))!;
        setSlot(session, 'ficha_current', nid);
        const text = `Omitido. Siguiente: ${form.title}.`;
        await appendAndSave(session, 'Omitir', text, mcp);
        return { text, form, bookmarks: await fichaBookmarks(mcp, session) };
      }
      const text = 'Última sección. Revisá lo que falte desde los marcadores.';
      await appendAndSave(session, 'Omitir', text, mcp);
      return { text, form: null, bookmarks: await fichaBookmarks(mcp, session) };
    }

    // Submit a group form.
    if (typeof sub?.form_id === 'string' && sub.form_id.startsWith('ficha_grp_')) {
      const gid = sub.form_id.slice('ficha_grp_'.length);
      const grp = FICHA_GROUPS.find(g => g.id === gid);
      const data: Record<string, unknown> = { ...(sub.data || {}) };

      // ── §4.7 / §8 image-upload groups ─────────────────────────────────
      // These groups don't write a field on the episode/patient — they
      // create clinical_image / consent records. The image-upload field's
      // value is a CSV of already-uploaded attachment ids.
      if (gid === 'g_4_7' || gid === 'g_8') {
        // Se engancha en el punto de llamada y no dentro: la función tiene varias
        // salidas y así todas quedan cubiertas sin repetir el recálculo en cada una.
        const r = await handleImageGroupSubmit(gid, data, session, mcp, message);
        await recalcularTrasGuardar(mcp, session);
        return r;
      }

      const isPatient = grp?.target === 'patient';
      const targetId = isPatient ? session.active_patient_id : session.active_episode_id;
      await prepararDatosGrupo(gid, data, mcp, session.active_episode_id);
      // Human-readable record of what the form submitted — written into chat.
      const fmt = (v: unknown) => v === true ? 'Sí' : v === false ? 'No' : String(v);
      const summaryLines = (grp?.fields || [])
        .filter(f => f.key && data[f.key] !== undefined && data[f.key] !== null && data[f.key] !== '')
        .map(f => `  • ${f.label}: ${fmt(data[f.key!])}`);
      // Surface the autocalculated BLINK result (not a form field).
      if (gid === 'g_blink' && data.blink_resultado) {
        summaryLines.push(`  • Resultado BLINK: ${data.blink_resultado}`);
      }
      const summary = `📋 ${grp?.label || 'Formulario'}\n` +
        (summaryLines.length ? summaryLines.join('\n') : '  (sin datos)');

      if (targetId && Object.keys(data).length) {
        const upd = await mcp.call('entities.update', {
          id: targetId, record_type: 'business', data,
        });
        if (!(upd as any)?.ok) {
          const text = `No pude guardar: ${(upd as any)?.error || 'error desconocido'}.\n` +
            `Revisá los datos y volvé a enviar.`;
          await appendAndSave(session, summary, text, mcp);
          return { text, form: await fichaGroupFormFilled(gid, mcp, session), bookmarks: await fichaBookmarks(mcp, session) };
        }
        if (isPatient) {
          try {
            const pr = await mcp.call('entities.get', { id: session.active_patient_id! });
            const pd = ((pr as any)?.data?.data) || {};
            setSlot(session, 'patient_context', { id: session.active_patient_id, ...pd });
          } catch { /* skip refresh */ }
        }
        await recalcularTrasGuardar(mcp, session);
      }
      const done: string[] = ((session.extracted_slots as any)?.ficha_done as string[]) || [];
      if (!done.includes(gid)) done.push(gid);
      setSlot(session, 'ficha_done', done);
      const nid = await nextIncompleteFichaGroupId(gid, mcp, session);
      if (nid) {
        const form = (await fichaGroupFormFilled(nid, mcp, session))!;
        setSlot(session, 'ficha_current', nid);
        const text = `Guardado. Siguiente: ${form.title}.`;
        await appendAndSave(session, summary, text, mcp);
        return { text, form, bookmarks: await fichaBookmarks(mcp, session) };
      }
      const text = 'Ficha completa. Podés revisar cualquier sección desde los marcadores.';
      await appendAndSave(session, summary, text, mcp);
      return { text, form: null, bookmarks: await fichaBookmarks(mcp, session) };
    }

    // Free text while the ficha is open — fall through to the rest of the pipeline.
  }

  // ── patient_info mode WITH active patient: answer questions about the
  // patient deterministically (no LLM, no command suggestions exposed). ──
  if (mode === 'patient_info' && session.active_patient_id) {
    const t = trimmed.toLowerCase();
    const pid = session.active_patient_id;
    const ctx = ((session.extracted_slots as any)?.patient_context || {}) as Record<string, any>;
    const nombre = [ctx.nombre, ctx.apellidos].filter(Boolean).join(' ') || 'el paciente';

    // Intent — prior consultations / clinical history.
    if (/consulta|atend|episodi|historial|visit|anterior|previo|antes|vino|vez/.test(t)) {
      let eps: any[] = [];
      try {
        const er = await mcp.call('entities.list', {
          type: EPISODE_ENTITY_ID, search: pid, limit: 50,
        });
        eps = Array.isArray((er as any)?.data) ? (er as any).data : [];
      } catch { /* treat as none */ }
      if (!eps.length) {
        const text = `${nombre} no tiene consultas registradas previamente.`;
        await appendAndSave(session, message, text, mcp);
        return { text };
      }
      eps.sort((a, b) =>
        String(b?.data?.fecha || '').localeCompare(String(a?.data?.fecha || '')));
      const lines = eps.slice(0, 10).map((e: any) => {
        const d = e.data || {};
        return `• ${d.fecha || 's/f'} — ${d.motivo_consulta || '(sin motivo)'}` +
          (d.estado ? ` [${d.estado}]` : '');
      });
      const text =
        `Sí, ${nombre} tiene ${eps.length} consulta(s) registrada(s):\n${lines.join('\n')}`;
      await appendAndSave(session, message, text, mcp);
      return { text };
    }

    // Intent — patient demographics / contact data.
    if (/dato|info|edad|sexo|sangre|c[eé]dula|tel[eé]fono|tel\b|direcci|email|correo|naci|qui[eé]n/.test(t)) {
      const edad = (() => {
        const dob = ctx.fecha_nac;
        if (!dob) return null;
        const d = new Date(dob);
        if (isNaN(d.getTime())) return null;
        const now = new Date();
        let a = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
        return a >= 0 && a < 150 ? a : null;
      })();
      const rows = [
        ['Nombre', [ctx.nombre, ctx.apellidos].filter(Boolean).join(' ')],
        ['Edad', edad != null ? `${edad} años` : null],
        ['Sexo', ctx.sexo],
        ['Cédula', ctx.cedula],
        ['Grupo sanguíneo', ctx.tipo_sangre],
        ['Teléfono', ctx.telefono],
        ['Email', ctx.email],
        ['Dirección', ctx.direccion],
      ].filter(([, v]) => v) as [string, string][];
      const text = `Datos de ${nombre}:\n` +
        rows.map(([k, v]) => `  • ${k}: ${v}`).join('\n');
      await appendAndSave(session, message, text, mcp);
      return { text };
    }

    // Fallback — stay conversational, never surface internal commands.
    const text =
      `En modo información puedo contarte el historial de consultas de ${nombre} ` +
      `o sus datos (edad, contacto, etc.). ¿Qué necesitás saber?`;
    await appendAndSave(session, message, text, mcp);
    return { text };
  }

  return null;
}
