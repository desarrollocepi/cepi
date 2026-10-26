<template>
  <!-- Ficha de evolución (PAPER §28): fecha, médico, diagnóstico y tratamiento de todas
       las fichas del paciente. Es un documento aparte de la ficha (public/evolucion.html,
       hermano de ficha.html) y se abre en un modal desde el chat o desde la ficha. -->
  <div class="evo-modal" @click.self="emit('close')">
    <div class="evo-panel">
      <div class="evo-head">
        <strong>Ficha de evolución — {{ patientName || 'Paciente' }}</strong>
        <div class="evo-head-actions">
          <button type="button" :disabled="cargando || !!error" @click="imprimir"
            :title="cargando ? 'Todavía se está cargando' : (error ? 'No se pudo cargar la evolución' : 'Imprimir la ficha de evolución')"
          >Imprimir</button>
          <button type="button" @click="emit('close')">Cerrar</button>
        </div>
      </div>
      <iframe ref="frame" class="evo-frame" src="/evolucion.html" @load="onLoad"></iframe>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getPatientEvolution, obtenerEntidad } from '../api.js';
import { edadDesde } from '../edad.js';

const props = defineProps({
  patientId: { type: String, required: true },
  /** La ficha que se está viendo: sale resaltada. */
  episodeId: { type: String, default: null },
  patientName: { type: String, default: '' },
});
const emit = defineEmits(['close', 'abrir']);

const frame = ref(null);
const cargando = ref(true);
const error = ref('');
let datos = null;
let documentoListo = false;

// Los datos y el documento llegan en cualquier orden: se llena cuando están los dos.
function llenar() {
  const win = frame.value?.contentWindow;
  if (!documentoListo || !win) return;
  try {
    if (error.value) { win.errorEvolucion?.(error.value); return; }
    if (!datos) return;
    win.onAbrirFicha = (id) => { if (id !== props.episodeId) emit('abrir', id); };
    win.fillEvolucion?.(datos);
  } catch { /* documento no listo */ }
}

function onLoad() { documentoListo = true; llenar(); }

async function cargar() {
  try {
    const [evo, paciente] = await Promise.all([
      getPatientEvolution(props.patientId),
      obtenerEntidad(props.patientId).catch(() => null),
    ]);
    const p = paciente?.data || {};
    datos = {
      paciente: {
        nombre: [p.nombre, p.apellidos].filter(Boolean).join(' ') || props.patientName,
        cedula: p.cedula || '',
        edad: edadDesde(p.fecha_nac),
      },
      filas: evo?.data || [],
      actual: props.episodeId,
    };
  } catch (e) {
    error.value = e?.message || 'No se pudo cargar la evolución';
  } finally {
    cargando.value = false;
    llenar();
  }
}

function imprimir() { frame.value?.contentWindow?.print(); }

onMounted(cargar);
</script>

<style scoped>
.evo-modal { position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 16px; }
.evo-panel { background: #fff; border-radius: 10px; overflow: hidden; width: min(840px, 96vw); height: min(96vh, 1200px); display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,.3); }
.evo-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border, #e2e8f0); font-size: 0.9rem; color: var(--text, #0f172a); }
.evo-head-actions { display: flex; gap: 6px; flex-shrink: 0; }
.evo-head button { border: 1.5px solid var(--border, #e2e8f0); background: #f8fafc; color: var(--text, #0f172a); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-weight: 600; font-size: 0.82rem; }
.evo-head button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.evo-head button:disabled { opacity: .45; cursor: not-allowed; }
.evo-frame { flex: 1; width: 100%; border: 0; background: #e8e8e8; }
@media (max-width: 560px) {
  .evo-modal { padding: 0; }
  .evo-panel { width: 100vw; height: 100dvh; border-radius: 0; }
}
</style>
