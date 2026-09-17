<template>
  <div class="visor">
    <!-- La barra sale siempre, aunque el formato no haya cargado: un botón que
         desaparece no dice si la función no existe o si algo falló (CLAUDE.md). -->
    <div class="visor-barra">
      <span class="visor-titulo">{{ titulo }}</span>
      <span v-if="cargando" class="visor-estado"><span class="visor-spin" />Rellenando…</span>
      <span v-else-if="error" class="visor-estado visor-error">{{ error }}</span>
      <span v-else-if="avisoGuardado" class="visor-estado" :class="{ 'visor-error': errorGuardado }">{{ avisoGuardado }}</span>
      <span v-else-if="avisoCampos" class="visor-estado visor-aviso" :title="avisoCampos">{{ avisoCampos }}</span>
      <!-- Guardar va a la IZQUIERDA de imprimir: primero se corrige, después se
           imprime. Y se guarda solo al pulsar — nunca campo a campo mientras se
           escribe: en un documento de una página se corrigen varias casillas
           antes de dar la versión por buena, y un autoguardado dejaría en la
           historia clínica estados intermedios que nadie firmó. -->
      <button
        class="visor-btn visor-btn--guardar" :disabled="cargando || !!error || !editable || guardando || !sucio"
        :title="tituloGuardar"
        @click="guardar"
      >{{ guardando ? 'Guardando…' : '💾 Guardar' }}</button>
      <button
        class="visor-btn" :disabled="cargando || !!error"
        :title="error ? 'El formato no cargó' : 'Abre el diálogo de impresión; en Chrome, «Guardar como PDF»'"
        @click="imprimir"
      >🖨️ Imprimir / PDF</button>
    </div>

    <!-- El :key va SOLO por `src`: cambiar de episodio no remonta el iframe, se
         vuelve a llamar a fillFicha() sobre el documento ya cargado. Remontarlo
         daba un flash blanco de página entera en cada salto entre casos. -->
    <iframe
      ref="marco" :key="src"
      :src="src" class="visor-marco" title="Formulario"
      @load="rellenar"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { obtenerEntidad, guardarFichaCompleta } from '../api.js';

/**
 * Visor de un formato de ficha servido como HTML suelto (public/*.html).
 *
 * El contrato es el mismo que ya usaba telemedicina con `ficha.html`, y por eso
 * los formatos nuevos (MSP 002, MSP 053, …) son archivos HTML y no componentes
 * Vue: se maquetan en A4 con su propio CSS de impresión, se abren dentro de un
 * iframe y el contenedor solo les pasa los datos. Cada formato expone en
 * `window`:
 *
 *   fillFicha(data)        ← obligatorio. Recibe paciente+episodio en plano.
 *   markChanges(cambios)   ← opcional. {clave: valorAnterior} para resaltar.
 *   readFicha()            ← opcional. Solo lo usa el visor editable del chat.
 *
 * Un formato es EDITABLE si expone `readFicha()`. Solo lo hace `ficha.html`, cuyas
 * casillas son campos de la ficha uno a uno. Los formatos del MSP no: sus casillas
 * son texto compuesto a partir de varios campos (§3 entero cae en «enfermedad
 * actual»), y no hay forma de deshacer esa concatenación sin corromper el dato. En
 * esos el botón de guardar sale deshabilitado, explicando por qué.
 */
const emit = defineEmits(['guardado']);
const props = defineProps({
  src:       { type: String, required: true },
  titulo:    { type: String, default: 'Formulario' },
  episodeId: { type: String, default: null },
  patientId: { type: String, default: null },
  visitas:   { type: Array,  default: () => [] },
});

const marco = ref(null);
const cargando = ref(true);
const error = ref('');
const avisoCampos = ref('');
const editable = ref(false);        // el formato expone readFicha()
const sucio = ref(false);           // hay algo distinto de lo que se cargó
const guardando = ref(false);
const avisoGuardado = ref('');
const errorGuardado = ref(false);

const tituloGuardar = computed(() => {
  if (error.value) return 'El formato no cargó';
  if (!editable.value) return 'Este formato es un documento generado: sus casillas se componen de varios campos de la ficha y no se pueden deshacer. Edita en «Grupos» o en «Ficha HCU».';
  if (!sucio.value) return 'No hay cambios que guardar';
  return 'Guarda los cambios en el paciente y el episodio';
});

/** Años cumplidos. La calcula el contenedor porque no es un campo guardado. */
function edadDesde(fechaNac) {
  const d = new Date(fechaNac);
  if (isNaN(d.getTime())) return null;
  const hoy = new Date();
  let a = hoy.getFullYear() - d.getFullYear();
  const m = hoy.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) a--;
  return (a >= 0 && a < 150) ? a : null;
}

/** Campos que cambian en toda visita: marcarlos en rojo no señalaría nada. */
const SIN_COMPARAR = new Set(['id', 'fecha', 'medico_id', 'patient_id', 'estado', 'tipo',
  'created_at', 'updated_at', 'ficha_num', 'examinador_nombre', 'gravedad_total', 'location',
  'drpro_cita_id', 'tipo_cita', 'ficha_completitud', 'ficha_faltantes', 'ficha_calculada_at',
  'ficha_grupos_con_dato', 'diagnostico_fuente', 'drpro_raw', 'drpro_raw_hash']);
const norm = (v) => (v === null || v === undefined || v === false || v === '') ? '' : String(v);

async function rellenar() {
  cargando.value = true; error.value = ''; avisoCampos.value = '';
  avisoGuardado.value = ''; errorGuardado.value = false;
  const win = marco.value?.contentWindow;
  editable.value = typeof win?.readFicha === 'function';
  if (!win?.fillFicha) {
    error.value = 'Este formato no expone fillFicha().';
    cargando.value = false;
    return;
  }
  try {
    const [pac, epi] = await Promise.all([
      props.patientId ? obtenerEntidad(props.patientId).catch(() => null) : null,
      props.episodeId ? obtenerEntidad(props.episodeId).catch(() => null) : null,
    ]);
    const pdata = pac || {};
    const edata = epi || {};
    const data = { ...pdata, ...edata };
    data.nombre = [pdata.nombre, pdata.apellidos].filter(Boolean).join(' ') || data.nombre;
    if (!data.edad && pdata.fecha_nac) {
      const a = edadDesde(pdata.fecha_nac);
      if (a !== null) data.edad = a;
    }
    win.fillFicha(data);

    // Mismo resaltado que la ficha de telemedicina: lo que cambió respecto de la
    // visita anterior del mismo paciente.
    const i = props.visitas.findIndex(v => v.id === props.episodeId);
    const previa = i >= 0 ? props.visitas[i + 1] : null;
    if (previa && win.markChanges) {
      const cambios = {};
      for (const k of new Set([...Object.keys(edata), ...Object.keys(previa)])) {
        if (SIN_COMPARAR.has(k) || k.includes(':')) continue;
        if (norm(edata[k]) !== norm(previa[k])) cambios[k] = previa[k];
      }
      win.markChanges(cambios);
    }

    // Estado recién cargado: sirve de referencia para saber si hay algo que
    // guardar. Un botón activo sin nada que guardar es una invitación a escribir
    // en la historia clínica una versión idéntica a la que ya estaba.
    instantanea = leerSerializado(win);
    sucio.value = false;
    escuchar(win);

    // Un formato puede no cubrir todos los campos con dato (ficha.html, por
    // ejemplo, no tiene §4.7 ni §8). Decirlo evita creer que el dato se perdió.
    if (typeof win.camposNoCubiertos === 'function') {
      const fuera = win.camposNoCubiertos(data) || [];
      if (fuera.length) avisoCampos.value = `${fuera.length} campos con dato no caben en este formato`;
    }
  } catch (e) {
    error.value = e?.message || 'No se pudo rellenar el formato';
  } finally {
    cargando.value = false;
  }
}

/** El documento serializado, o '' si el formato no se puede leer. */
let instantanea = '';
function leerSerializado(win) {
  try { return JSON.stringify(win?.readFicha?.() || {}); } catch { return ''; }
}

/**
 * Se escucha DENTRO del iframe. Los eventos de un documento embebido no suben al
 * documento padre, así que sin esto no habría forma de enterarse de que alguien
 * escribió. Se engancha una sola vez por documento cargado: `rellenar()` corre
 * también al cambiar de episodio, y volver a suscribirse duplicaría el trabajo.
 */
function escuchar(win) {
  if (!win || win.__cepiEscuchando) return;
  const revisar = () => { sucio.value = leerSerializado(win) !== instantanea; };
  win.document.addEventListener('input', revisar, true);
  win.document.addEventListener('change', revisar, true);
  win.__cepiEscuchando = true;
}

/**
 * Lee el documento entero y lo manda de una vez. El backend reparte cada clave a
 * su entidad y descarta lo que no sea campo de la ficha, así que las casillas
 * propias del formato (unicódigo, signos vitales) no ensucian el episodio.
 */
async function guardar() {
  const win = marco.value?.contentWindow;
  if (!win?.readFicha || guardando.value) return;
  guardando.value = true; avisoGuardado.value = ''; errorGuardado.value = false;
  try {
    const data = win.readFicha() || {};
    const r = await guardarFichaCompleta({
      episodeId: props.episodeId, patientId: props.patientId, data,
    });
    const n = (r?.camposPaciente || 0) + (r?.camposEpisodio || 0);
    if (r?.ok) {
      // Lo guardado pasa a ser la referencia: sin esto el botón seguiría activo
      // ofreciendo guardar de nuevo exactamente lo mismo.
      instantanea = JSON.stringify(data);
      sucio.value = false;
      avisoGuardado.value = `Guardado · ${n} ${n === 1 ? 'campo' : 'campos'}` +
        (r.completitud !== null && r.completitud !== undefined ? ` · ficha al ${r.completitud}%` : '');
    } else {
      errorGuardado.value = true;
      avisoGuardado.value = 'Guardado con errores: ' + (r?.errores || []).join('; ');
    }
    emit('guardado', r);
  } catch (e) {
    errorGuardado.value = true;
    avisoGuardado.value = e?.message || 'No se pudo guardar';
  } finally {
    guardando.value = false;
  }
}

/** Imprime SOLO el iframe: el diálogo del navegador ofrece «Guardar como PDF». */
function imprimir() {
  const win = marco.value?.contentWindow;
  if (!win) return;
  win.focus();
  win.print();
}

// Cambió el episodio (o su lista de hermanos) sin recargar el documento: se
// rellena de nuevo sobre el mismo iframe. `rellenar` limpia y repinta todos los
// campos, así que no quedan restos del episodio anterior.
watch(() => [props.episodeId, props.patientId, props.visitas], () => {
  if (marco.value?.contentWindow?.fillFicha) rellenar();
});

defineExpose({ imprimir, guardar });
</script>

<style scoped>
.visor { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.visor-barra { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.visor-titulo { font-size: 13px; font-weight: 700; color: #0f172a; }
.visor-estado { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #64748b; }
.visor-error { color: #b91c1c; }
.visor-aviso { color: #b45309; cursor: help; }
.visor-btn--guardar { margin-left: auto; background: #16a34a; }
.visor-btn--guardar:hover:not(:disabled) { background: #15803d; }
/* Con el de guardar presente, el margen automático ya lo empuja él. */
.visor-btn--guardar ~ .visor-btn { margin-left: 0; }
.visor-btn { margin-left: auto; padding: 7px 14px; font-size: 13px; font-weight: 600; color: #fff; background: #0ea5e9; border: 0; border-radius: 6px; cursor: pointer; }
.visor-btn:hover:not(:disabled) { background: #0284c7; }
.visor-btn:disabled { color: #94a3b8; background: #e2e8f0; cursor: default; }
.visor-spin { width: 12px; height: 12px; border: 2px solid #cbd5e1; border-top-color: #0369a1; border-radius: 50%; animation: visor-giro .7s linear infinite; }
@keyframes visor-giro { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .visor-spin { animation-duration: 2.4s; } }

/* El formato trae su propio ancho A4; el iframe solo le da sitio y scroll. */
.visor-marco { flex: 1; min-height: 0; width: 100%; border: 0; background: #e2e8f0; }
</style>
