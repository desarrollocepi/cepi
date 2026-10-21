<template>
  <!-- Ficha de evolución (PAPER §28): fecha, médico, diagnóstico y tratamiento de todas
       las fichas del paciente. Va dentro de la ficha, plegada, para que se consulte
       desde cualquiera de ellas sin dejar la que se está leyendo. -->
  <section class="evo" :class="{ 'evo--abierta': abierta }">
    <header class="evo-barra">
      <strong>Evolución del paciente</strong>
      <span class="evo-cuenta">{{ resumen }}</span>
      <button
        class="evo-btn" type="button" :disabled="!patientId" @click="alternar"
        :title="patientId ? null : 'Todavía no se sabe de qué paciente es esta ficha'"
      >{{ abierta ? 'Ocultar' : 'Ver evolución' }}</button>
    </header>

    <template v-if="abierta">
      <p v-if="cargando && !filas.length" class="evo-estado">Cargando la evolución…</p>
      <p v-else-if="error" class="evo-estado evo-error">
        {{ error }}
        <button class="evo-btn evo-btn--sec" type="button" @click="cargar">Reintentar</button>
      </p>
      <p v-else-if="!filas.length" class="evo-estado">Este paciente todavía no tiene fichas registradas.</p>
      <div v-else class="evo-scroll">
        <table class="evo-tabla">
          <thead>
            <tr><th>Fecha</th><th>Médico</th><th>Diagnóstico</th><th>Tratamiento</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="f in filas" :key="f.episode_id"
              :class="{ 'evo-actual': f.episode_id === episodeId }"
              :title="f.episode_id === episodeId ? 'Es la ficha que estás viendo' : 'Abrir esta ficha'"
              @click="abrir(f)"
            >
              <td class="evo-fecha" data-col="Fecha">{{ f.fecha || '—' }}</td>
              <td data-col="Médico" :class="{ 'evo-vacio': !f.medico }">{{ f.medico || '—' }}</td>
              <td data-col="Diagnóstico" :class="{ 'evo-vacio': !f.diagnostico }">{{ f.diagnostico || 'Sin diagnóstico' }}</td>
              <td data-col="Tratamiento" :class="{ 'evo-vacio': !f.tratamiento }">{{ f.tratamiento || 'Sin tratamiento' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { getPatientEvolution } from '../api.js';

const props = defineProps({
  patientId: { type: String, default: null },
  /** La ficha abierta: se resalta en la tabla. */
  episodeId: { type: String, default: null },
});
const emit = defineEmits(['navegar']);

const abierta = ref(false);
const filas = ref([]);
const cargando = ref(false);
const error = ref('');
const cargada = ref(false);

const resumen = computed(() => {
  if (!cargada.value) return 'fecha, médico, diagnóstico y tratamiento de cada ficha';
  const n = filas.value.length;
  return n === 1 ? '1 ficha' : `${n} fichas`;
});

async function cargar() {
  if (!props.patientId) return;
  cargando.value = true; error.value = '';
  try {
    const r = await getPatientEvolution(props.patientId);
    filas.value = r?.data || [];
    cargada.value = true;
  } catch (e) {
    error.value = e?.message || 'No se pudo cargar la evolución';
  } finally {
    cargando.value = false;
  }
}

// Se pide al abrirla y cada vez que se vuelve a abrir: entre una y otra se pudo
// guardar un diagnóstico o un tratamiento en la ficha.
function alternar() {
  abierta.value = !abierta.value;
  if (abierta.value) cargar();
}

function abrir(f) {
  if (f.episode_id !== props.episodeId) emit('navegar', f.episode_id);
}

watch(() => props.patientId, () => {
  filas.value = []; cargada.value = false;
  if (abierta.value) cargar();
});

// Tras guardar un grupo de la ficha: solo si está a la vista.
defineExpose({ recargar: () => (abierta.value ? cargar() : undefined) });
</script>

<style scoped>
.evo { margin-bottom: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
.evo-barra { display: flex; align-items: center; gap: 10px; padding: 9px 12px; }
.evo-barra strong { font-size: 13px; color: #0f172a; }
.evo-cuenta { flex: 1; min-width: 0; font-size: 12px; color: #64748b; }
.evo-btn { flex-shrink: 0; margin-left: auto; padding: 6px 12px; font-size: 13px; font-weight: 600; color: #0369a1; background: #fff; border: 1px solid #bae6fd; border-radius: 6px; cursor: pointer; }
.evo-btn:hover:not(:disabled) { background: #e0f2fe; }
.evo-btn:disabled { color: #94a3b8; border-color: #e2e8f0; cursor: default; }
.evo-btn--sec { margin-left: 8px; padding: 3px 9px; font-size: 12px; }
.evo-estado { margin: 0; padding: 4px 12px 12px; font-size: 13px; color: #64748b; }
.evo-error { color: #b91c1c; }

.evo-scroll { max-height: 320px; overflow: auto; border-top: 1px solid #e2e8f0; }
.evo-tabla { width: 100%; border-collapse: collapse; font-size: 13px; }
.evo-tabla th { position: sticky; top: 0; padding: 7px 10px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.evo-tabla td { padding: 7px 10px; vertical-align: top; color: #0f172a; border-bottom: 1px solid #f1f5f9; white-space: pre-wrap; overflow-wrap: anywhere; }
.evo-tabla tbody tr { cursor: pointer; }
.evo-tabla tbody tr:hover { background: #f0f9ff; }
.evo-tabla tr.evo-actual { background: #e0f2fe; cursor: default; }
.evo-tabla tr.evo-actual td:first-child { box-shadow: inset 3px 0 0 #0ea5e9; }
.evo-fecha { white-space: nowrap; }
/* Sin dato no es un error: en gris, como los grupos vacíos de la ficha. */
.evo-tabla td.evo-vacio { color: #94a3b8; font-style: italic; }

/* En el teléfono cada ficha es una tarjeta: cuatro columnas no entran. */
@media (max-width: 560px) {
  .evo-cuenta { display: none; }
  .evo-tabla thead { display: none; }
  .evo-tabla tr { display: block; padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
  .evo-tabla td { display: grid; grid-template-columns: 92px 1fr; gap: 8px; padding: 3px 12px; border: 0; }
  .evo-tabla td::before { content: attr(data-col); font-size: 12px; font-style: normal; color: #64748b; }
}
</style>
