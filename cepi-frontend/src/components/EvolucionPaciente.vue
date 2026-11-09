<template>
  <!-- Ficha de evolución (PAPER §28): una fila por ficha del paciente. Dos lugares:
       plegada dentro de la ficha, para consultarla sin dejar la que se lee, y como
       pestaña propia del paciente (`plegable=false`), abierta y a toda la altura.
       «Imprimir» abre el documento A4 (evolucion.html) en VisorEvolucion. -->
  <section class="evo" :class="{ 'evo--abierta': abierta, 'evo--pestana': !plegable }">
    <header class="evo-barra">
      <strong>Evolución del paciente</strong>
      <span class="evo-cuenta">{{ resumen }}</span>
      <button
        v-if="plegable"
        class="evo-btn" type="button" :disabled="!patientId" @click="alternar"
        :title="patientId ? null : 'Todavía no se sabe de qué paciente es esta ficha'"
      >{{ abierta ? 'Ocultar' : 'Ver evolución' }}</button>
      <template v-else>
        <button
          class="evo-btn" type="button" :disabled="!patientId || cargando" @click="cargar"
          :title="cargando ? 'Ya se está cargando' : 'Volver a leer las fichas'"
        >Actualizar</button>
        <button
          class="evo-btn evo-btn--junto" type="button" :disabled="!patientId || !filas.length" @click="imprimiendo = true"
          :title="!filas.length ? 'Sin fichas no hay nada que imprimir' : 'Abrir la ficha de evolución para imprimir'"
        >Imprimir</button>
      </template>
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
            <tr>
              <th>Fecha</th><th>Atendió</th><th>Diagnóstico clínico</th><th>Diagnóstico histopatológico</th>
              <th>Tratamiento</th><th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="f in filas" :key="f.episode_id"
              :class="{ 'evo-actual': f.episode_id === episodeId }"
              :title="f.episode_id === episodeId ? 'Es la ficha que estás viendo' : 'Abrir esta ficha'"
              @click="abrir(f)"
            >
              <td class="evo-fecha" data-col="Fecha">{{ f.fecha || '—' }}</td>
              <td data-col="Atendió" :class="{ 'evo-vacio': !f.medico && !f.especialista }">
                {{ f.medico || '—' }}<span v-if="f.especialista" class="evo-especialista">Especialista: {{ f.especialista }}</span>
              </td>
              <td data-col="Dx clínico" :class="{ 'evo-vacio': !f.diagnostico }">{{ f.diagnostico || 'Sin diagnóstico' }}</td>
              <td data-col="Dx histopatológico" :class="{ 'evo-vacio': !f.diagnostico_histopatologico }">{{ f.diagnostico_histopatologico || 'Sin biopsia' }}</td>
              <td data-col="Tratamiento" :class="{ 'evo-vacio': !f.tratamiento }">{{ f.tratamiento || 'Sin tratamiento' }}</td>
              <!-- Observaciones se escribe aquí mismo (pedido de las dermatólogas): es el
                   resumen del caso. Guarda en la sección 7 de esa ficha, sin confirmación:
                   es una acción explícita. El clic no abre la ficha de la fila. -->
              <td data-col="Observaciones" class="evo-obs" :class="{ 'evo-vacio': !f.observaciones && editando !== f.episode_id }" @click.stop>
                <div v-if="editando === f.episode_id">
                  <textarea
                    v-model="borrador" class="evo-obs-texto" rows="3" :disabled="guardando"
                    placeholder="Resumen de lo más importante de esta ficha" aria-label="Observaciones"
                  ></textarea>
                  <p v-if="errorGuardar" class="evo-obs-error">{{ errorGuardar }}</p>
                  <div class="evo-obs-acciones">
                    <button
                      class="evo-btn" type="button" :disabled="guardando || borrador.trim() === (f.observaciones || '')"
                      :title="guardando ? 'Guardando…' : (borrador.trim() === (f.observaciones || '') ? 'No hay cambios que guardar' : 'Guardar en la ficha')"
                      @click="guardarObservaciones(f)"
                    >{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
                    <button class="evo-btn evo-btn--junto" type="button" :disabled="guardando" @click="cancelarEdicion">Cancelar</button>
                  </div>
                </div>
                <div v-else>
                  <span>{{ f.observaciones || 'Sin observaciones' }}</span>
                  <button
                    class="evo-obs-editar" type="button"
                    :disabled="!!editando"
                    :title="editando ? 'Termina primero la otra observación' : 'Editar las observaciones de esta ficha'"
                    @click="editar(f)"
                  >✏️ Editar</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <VisorEvolucion
      v-if="imprimiendo && patientId"
      :patient-id="patientId" :episode-id="episodeId"
      @close="imprimiendo = false" @abrir="(id) => { imprimiendo = false; emit('navegar', id); }"
    />
  </section>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { getPatientEvolution, guardarGrupoFicha } from '../api.js';
import VisorEvolucion from './VisorEvolucion.vue';

const props = defineProps({
  patientId: { type: String, default: null },
  /** La ficha abierta: se resalta en la tabla. */
  episodeId: { type: String, default: null },
  /** Plegada dentro de la ficha (por defecto) o abierta como pestaña del paciente. */
  plegable: { type: Boolean, default: true },
});
const emit = defineEmits(['navegar', 'guardado']);

const abierta = ref(!props.plegable);
const editando = ref(null);      // episode_id de la fila cuyas observaciones se editan
const borrador = ref('');
const guardando = ref(false);
const errorGuardar = ref('');
const imprimiendo = ref(false);
const filas = ref([]);
const cargando = ref(false);
const error = ref('');
const cargada = ref(false);

const resumen = computed(() => {
  if (!cargada.value) return 'fecha, quién atendió, diagnósticos, tratamiento y observaciones de cada ficha';
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

function editar(f) {
  editando.value = f.episode_id;
  borrador.value = f.observaciones || '';
  errorGuardar.value = '';
}

function cancelarEdicion() {
  editando.value = null;
  errorGuardar.value = '';
}

// Va por el mismo camino que la sección 7 de la ficha (cepi-bot, grupo g_7): mismas
// coerciones y mismo historial en el chatter. Solo viaja `observaciones`; el resto de
// la sección no se toca.
async function guardarObservaciones(f) {
  guardando.value = true; errorGuardar.value = '';
  try {
    const texto = borrador.value.trim();
    await guardarGrupoFicha({ groupId: 'g_7', data: { observaciones: texto }, episodeId: f.episode_id, patientId: props.patientId });
    f.observaciones = texto || null;
    editando.value = null;
    emit('guardado', f.episode_id);
  } catch (e) {
    errorGuardar.value = e?.message || 'No se pudo guardar';
  } finally {
    guardando.value = false;
  }
}

function abrir(f) {
  if (f.episode_id !== props.episodeId) emit('navegar', f.episode_id);
}

watch(() => props.patientId, () => {
  filas.value = []; cargada.value = false; editando.value = null;
  if (abierta.value) cargar();
});

// Como pestaña se abre ya cargada.
if (!props.plegable) cargar();

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
.evo-btn--junto { margin-left: 0; }
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
.evo-obs { min-width: 160px; }
.evo-obs-editar { display: block; margin-top: 4px; padding: 2px 8px; font-size: 12px; font-style: normal; color: #0369a1; background: #fff; border: 1px solid #bae6fd; border-radius: 6px; cursor: pointer; }
.evo-obs-editar:hover:not(:disabled) { background: #e0f2fe; }
.evo-obs-editar:disabled { color: #94a3b8; border-color: #e2e8f0; cursor: default; }
.evo-obs-texto { width: 100%; box-sizing: border-box; padding: 6px; font: inherit; font-size: 13px; border: 1px solid #94a3b8; border-radius: 6px; resize: vertical; }
.evo-obs-acciones { display: flex; gap: 6px; margin-top: 4px; }
.evo-obs-acciones .evo-btn { margin-left: 0; }
.evo-obs-error { margin: 4px 0 0; font-size: 12px; color: #b91c1c; font-style: normal; }
.evo-especialista { display: block; margin-top: 2px; font-size: 12px; color: #0369a1; }
/* Como pestaña ocupa todo el alto: la tabla se desplaza dentro, con la cabecera fija. */
.evo--pestana { display: flex; flex-direction: column; min-height: 0; height: 100%; margin: 0; border: 0; border-radius: 0; }
.evo--pestana .evo-scroll { flex: 1; max-height: none; }
/* Sin dato no es un error: en gris, como los grupos vacíos de la ficha. */
.evo-tabla td.evo-vacio { color: #94a3b8; font-style: italic; }

/* En el teléfono cada ficha es una tarjeta: seis columnas no entran. */
@media (max-width: 560px) {
  .evo-cuenta { display: none; }
  .evo-tabla thead { display: none; }
  .evo-tabla tr { display: block; padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
  .evo-tabla td { display: grid; grid-template-columns: 116px 1fr; gap: 8px; padding: 3px 12px; border: 0; }
  .evo-tabla td::before { content: attr(data-col); font-size: 12px; font-style: normal; color: #64748b; }
}
</style>
