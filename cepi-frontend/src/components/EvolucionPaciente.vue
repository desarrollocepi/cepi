<template>
  <!-- Evolución (PAPER §28, §28.4): una ficha tiene varias evoluciones (citas). Se ven las
       de la ficha abierta, con su cabecera y «＋ Agregar evolución»; debajo, plegadas, las
       otras fichas del paciente. Dos lugares: plegada dentro de la ficha y como pestaña
       propia del paciente (`plegable=false`). «Imprimir» abre el documento A4
       (evolucion.html), que agrupa por ficha. -->
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

    <div v-if="abierta" class="evo-cuerpo">
      <p v-if="cargando && !filas.length" class="evo-estado">Cargando la evolución…</p>
      <p v-else-if="error" class="evo-estado evo-error">
        {{ error }}
        <button class="evo-btn evo-btn--sec" type="button" @click="cargar">Reintentar</button>
      </p>
      <template v-else>
        <!-- Cabecera de la ficha abierta: motivo, apertura y estado, y agregar una cita. -->
        <div class="evo-ficha">
          <div class="evo-ficha-datos">
            <template v-if="actual">
              <span class="evo-ficha-motivo">{{ actual.motivo || 'Sin motivo registrado' }}</span>
              <span class="evo-ficha-meta">
                Abierta el {{ actual.apertura || '—' }} ·
                <span class="evo-chip" :class="{ 'evo-chip--alta': actual.estado === 'alta' }">{{ etiquetaEstado(actual.estado) }}</span>
                · {{ cuentaEvoluciones(actual) }}
              </span>
            </template>
            <span v-else class="evo-ficha-meta">Este paciente todavía no tiene fichas registradas.</span>
          </div>
          <button
            class="evo-btn evo-btn--primario" type="button"
            :disabled="!!motivoNoAgregar" :title="motivoNoAgregar || 'Registrar una cita de control en esta ficha'"
            @click="abrirFormulario"
          >＋ Agregar evolución</button>
        </div>

        <!-- Formulario de la evolución: nueva, o una existente que se tocó (PAPER §28.4.1).
             Acción explícita: se guarda sin confirmación. -->
        <form v-if="formulario" ref="formEl" class="evo-form" @submit.prevent="guardarEvolucion">
          <p class="evo-form-titulo">{{ enEdicion ? `Editar la evolución del ${enEdicion.fecha || '—'}` : 'Evolución nueva' }}</p>
          <label class="evo-campo evo-campo--corto">
            <span>Fecha</span>
            <input v-model="nueva.fecha" type="date" :disabled="enviando" required />
          </label>
          <label class="evo-campo">
            <span>Hallazgos</span>
            <textarea v-model="nueva.hallazgos" rows="2" :disabled="enviando" placeholder="Lo que se encontró en la cita"></textarea>
          </label>
          <div class="evo-campo">
            <span>Diagnóstico</span>
            <IcdSearchField v-model="nueva.diagnostico" :field="campoDiagnostico" :busy="enviando" />
          </div>
          <label class="evo-campo">
            <span>Tratamiento</span>
            <textarea v-model="nueva.tratamiento" rows="2" :disabled="enviando" placeholder="Indicado en esta cita"></textarea>
          </label>
          <label class="evo-campo">
            <span>Observaciones</span>
            <textarea v-model="nueva.observaciones" rows="2" :disabled="enviando" placeholder="Resumen libre"></textarea>
          </label>
          <div class="evo-fila">
            <label class="evo-campo evo-campo--corto">
              <span>Próximo control</span>
              <input ref="controlEl" v-model="nueva.proximoControlFecha" type="date" :disabled="enviando || fichaDeAlta" :title="fichaDeAlta ? 'Ficha de alta: abre una consulta nueva para otro control' : ''" />
            </label>
            <label class="evo-campo">
              <span>Qué hacer en el control</span>
              <input v-model="nueva.proximoControlMotivo" type="text" :disabled="enviando || fichaDeAlta" placeholder="Motivo del próximo control" />
            </label>
          </div>
          <p v-if="errorNueva" class="evo-obs-error">{{ errorNueva }}</p>
          <div class="evo-obs-acciones">
            <button
              class="evo-btn" type="submit" :disabled="enviando || !!motivoNoGuardar"
              :title="enviando ? 'Guardando…' : (motivoNoGuardar || (enEdicion ? 'Guardar los cambios de esta evolución' : 'Guardar la evolución en esta ficha'))"
            >{{ enviando ? 'Guardando…' : (enEdicion ? 'Guardar cambios' : 'Guardar evolución') }}</button>
            <button class="evo-btn evo-btn--junto" type="button" :disabled="enviando" @click="cerrarFormulario">Cancelar</button>
          </div>
        </form>

        <div v-if="actual" class="evo-scroll">
          <table class="evo-tabla">
            <thead>
              <tr>
                <th>Fecha</th><th>Atendió</th><th>Diagnóstico clínico</th><th>Diagnóstico histopatológico</th>
                <th>Tratamiento</th><th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              <!-- La más vieja arriba, la más nueva abajo (PAPER §28.4.1). Tocar la fila abre su
                   formulario; las observaciones se siguen editando aquí mismo. -->
              <tr
                v-for="f in filasEnOrden" :key="claveFila(f)" class="evo-fila-tocable"
                :class="{ 'evo-fila-editando': enEdicion && claveFila(enEdicion) === claveFila(f) }"
                tabindex="0" title="Abrir el formulario de esta evolución"
                @click="abrirEdicion(f)" @keydown.enter.self="abrirEdicion(f)"
              >
                <td class="evo-fecha" data-col="Fecha">
                  {{ f.fecha || '—' }}<span v-if="f.es_inicial && f.evolution_id" class="evo-inicial">Primera cita</span>
                </td>
                <td data-col="Atendió" :class="{ 'evo-vacio': !f.medico && !f.especialista }">
                  {{ f.medico || '—' }}<span v-if="f.especialista" class="evo-especialista">Especialista: {{ f.especialista }}</span>
                </td>
                <td data-col="Dx clínico" :class="{ 'evo-vacio': !f.diagnostico && !f.hallazgos }">
                  {{ f.diagnostico || 'Sin diagnóstico' }}<span v-if="f.hallazgos" class="evo-extra">Hallazgos: {{ f.hallazgos }}</span>
                </td>
                <td data-col="Dx histopatológico" :class="{ 'evo-vacio': !f.diagnostico_histopatologico }">{{ f.diagnostico_histopatologico || 'Sin biopsia' }}</td>
                <td data-col="Tratamiento" :class="{ 'evo-vacio': !f.tratamiento && !f.proximo_control_fecha }">
                  {{ f.tratamiento || 'Sin tratamiento' }}<span v-if="f.proximo_control_fecha || f.proximo_control_motivo" class="evo-extra">Próximo control: {{ [f.proximo_control_fecha, f.proximo_control_motivo].filter(Boolean).join(' · ') }}</span>
                </td>
                <!-- Observaciones se escribe aquí mismo (pedido de las dermatólogas). Una
                     evolución registrada guarda en ella (editarEvolucion); la fila armada de
                     una ficha sin evoluciones, en la sección 7 de la ficha (g_7). -->
                <td data-col="Observaciones" class="evo-obs" :class="{ 'evo-vacio': !f.observaciones && editando !== claveFila(f) }" @click.stop>
                  <div v-if="editando === claveFila(f)">
                    <textarea
                      v-model="borrador" class="evo-obs-texto" rows="3" :disabled="guardando"
                      placeholder="Resumen de lo más importante de esta cita" aria-label="Observaciones"
                    ></textarea>
                    <p v-if="errorGuardar" class="evo-obs-error">{{ errorGuardar }}</p>
                    <div class="evo-obs-acciones">
                      <button
                        class="evo-btn" type="button" :disabled="guardando || borrador.trim() === (f.observaciones || '')"
                        :title="guardando ? 'Guardando…' : (borrador.trim() === (f.observaciones || '') ? 'No hay cambios que guardar' : 'Guardar las observaciones')"
                        @click="guardarObservaciones(f)"
                      >{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
                      <button class="evo-btn evo-btn--junto" type="button" :disabled="guardando" @click="cancelarEdicion">Cancelar</button>
                    </div>
                  </div>
                  <div v-else class="evo-obs-linea">
                    <span>{{ f.observaciones || 'Sin observaciones' }}</span>
                    <button
                      class="evo-obs-editar" type="button"
                      :disabled="!!editando"
                      :title="editando ? 'Termina primero la otra observación' : 'Editar las observaciones de esta cita'"
                      :aria-label="editando ? 'Termina primero la otra observación' : 'Editar las observaciones de esta cita'"
                      @click="editar(f)"
                    >✏️</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Próximo control de la ficha abierta (PAPER §28.4): el de su evolución más nueva. -->
        <!-- Tocarlo abre el formulario de la evolución más reciente con el foco en el próximo
             control. Con la ficha de alta sigue a la vista, sin abrir nada, y lo dice. -->
        <button
          v-if="actual" type="button" class="evo-control" :class="nextControl.status ? `evo-control--${nextControl.status}` : null"
          :disabled="fichaDeAlta || enviando"
          :title="fichaDeAlta ? 'Ficha de alta: abre una consulta nueva para otro control' : 'Fijar o cambiar el próximo control'"
          @click="abrirEdicion(actual.filas[0], true)"
        >
          <strong>Próximo control</strong>
          <template v-if="nextControl.date">
            <span class="evo-control-fecha">{{ nextControl.date }}</span>
            <span class="evo-control-estado">{{ nextControl.label }}</span>
            <span class="evo-control-motivo">{{ nextControl.reason || 'Sin indicación de qué hacer' }}</span>
          </template>
          <span v-else class="evo-control-vacio">{{ nextControl.empty }}</span>
          <span v-if="!fichaDeAlta" class="evo-control-editar">✏️</span>
        </button>

        <!-- Las otras fichas del paciente, plegadas: una línea por ficha. Tocarla la abre. -->
        <div class="evo-otras">
          <button
            class="evo-otras-btn" type="button" :disabled="!otras.length" :aria-expanded="verOtras"
            :title="otras.length ? 'Ver las otras fichas del paciente' : 'Es la única ficha de este paciente'"
            @click="verOtras = !verOtras"
          >{{ verOtras ? '▾' : '▸' }} Otras fichas del paciente ({{ otras.length }})</button>
          <ul v-if="verOtras && otras.length" class="evo-otras-lista">
            <li v-for="o in otras" :key="o.episode_id">
              <button type="button" class="evo-otra" title="Abrir esta ficha" @click="emit('navegar', o.episode_id)">
                <span class="evo-otra-motivo">{{ o.motivo || 'Sin motivo registrado' }}</span>
                <span class="evo-otra-meta">{{ o.apertura || '—' }} · {{ etiquetaEstado(o.estado) }} · {{ cuentaEvoluciones(o) }}</span>
              </button>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <VisorEvolucion
      v-if="imprimiendo && patientId"
      :patient-id="patientId" :episode-id="actual?.episode_id || episodeId"
      @close="imprimiendo = false" @abrir="(id) => { imprimiendo = false; emit('navegar', id); }"
    />
  </section>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { listarEvolucion, guardarGrupoFicha, agregarEvolucion, editarEvolucion } from '../api.js';
import VisorEvolucion from './VisorEvolucion.vue';
import IcdSearchField from './IcdSearchField.vue';

const props = defineProps({
  patientId: { type: String, default: null },
  /** La ficha abierta: se muestran sus evoluciones. Sin ella, la más nueva. */
  episodeId: { type: String, default: null },
  /** Plegada dentro de la ficha (por defecto) o abierta como pestaña del paciente. */
  plegable: { type: Boolean, default: true },
});
const emit = defineEmits(['navegar', 'guardado']);

const ESTADOS = {
  agendado: 'Agendada', en_curso: 'En curso', enviada: 'Enviada', en_triage: 'En triage', derivada: 'Derivada',
  'en_revisión_solicitada': 'Revisión solicitada', respondida: 'Respondida', cerrado: 'Cerrada', alta: 'Alta',
};
const campoDiagnostico = { key: 'diagnostico', placeholder: 'Buscar diagnóstico en CIE-10…' };

const abierta = ref(!props.plegable);
const editando = ref(null);      // clave de la fila cuyas observaciones se editan
const borrador = ref('');
const guardando = ref(false);
const errorGuardar = ref('');
const imprimiendo = ref(false);
const filas = ref([]);
const cargando = ref(false);
const error = ref('');
const cargada = ref(false);
const verOtras = ref(false);
const formulario = ref(false);
const enviando = ref(false);
const errorNueva = ref('');
const nueva = reactive(vacia());
/** La fila que se edita en el formulario; null = evolución nueva. */
const enEdicion = ref(null);
const formEl = ref(null);
const controlEl = ref(null);

/** 'YYYY-MM-DD' de hoy en la zona del dispositivo (nunca toISOString: da el día UTC). */
function hoyLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function vacia() {
  return {
    fecha: hoyLocal(), hallazgos: '', diagnostico: '', tratamiento: '', observaciones: '',
    proximoControlFecha: '', proximoControlMotivo: '',
  };
}

const claveFila = (f) => f.evolution_id || f.episode_id;
const etiquetaEstado = (e) => (e ? (ESTADOS[e] || e.replace(/_/g, ' ')) : 'Sin estado');
const cuentaEvoluciones = (ficha) => (ficha.filas.length === 1 ? '1 evolución' : `${ficha.filas.length} evoluciones`);

/** Las filas agrupadas por ficha, en el orden en que llegan (la más nueva primero). */
const fichas = computed(() => {
  const out = [];
  const porId = new Map();
  for (const f of filas.value) {
    let g = porId.get(f.episode_id);
    if (!g) {
      g = { episode_id: f.episode_id, motivo: f.motivo || null, estado: f.estado || null, filas: [], apertura: null };
      porId.set(f.episode_id, g);
      out.push(g);
    }
    g.filas.push(f);
  }
  // La apertura es la primera cita: la fila más vieja de la ficha.
  for (const g of out) g.apertura = g.filas[g.filas.length - 1]?.fecha || null;
  return out;
});

const actual = computed(() => fichas.value.find((g) => g.episode_id === props.episodeId) || fichas.value[0] || null);
/** Próximo control vigente de la ficha abierta: el de su evolución más nueva (llegan la más nueva primero). */
const nextControl = computed(() => {
  const g = actual.value;
  const latest = g?.filas[0] || null;
  const date = latest?.proximo_control_fecha || null;
  if (!date) {
    return { date: null, empty: g?.estado === 'alta' ? 'Ficha de alta: sin controles pendientes' : 'Sin próximo control indicado' };
  }
  const today = hoyLocal();
  const status = date < today ? 'atrasado' : (date === today ? 'hoy' : 'proximo');
  const label = { atrasado: 'Atrasado', hoy: 'Hoy', proximo: 'Próximo' }[status];
  return { date, status, label, reason: latest.proximo_control_motivo || null };
});
const otras = computed(() => fichas.value.filter((g) => g !== actual.value));
/** Para mostrar: de la más vieja a la más nueva. Internamente, la más nueva va primero. */
const filasEnOrden = computed(() => (actual.value ? [...actual.value.filas].reverse() : []));
const fichaDeAlta = computed(() => actual.value?.estado === 'alta');

/** Lo que cambió en el formulario de edición respecto de la fila (claves de editarEvolucion). */
const cambios = computed(() => {
  const f = enEdicion.value;
  if (!f) return {};
  const orig = {
    fecha: f.fecha || '', hallazgos: f.hallazgos || '', diagnostico: f.diagnostico || '',
    tratamiento: f.tratamiento || '', observaciones: f.observaciones || '',
    proximoControlFecha: f.proximo_control_fecha || '', proximoControlMotivo: f.proximo_control_motivo || '',
  };
  const out = {};
  for (const k of Object.keys(orig)) {
    const v = String(nueva[k] || '').trim();
    if (v !== orig[k]) out[k] = v;
  }
  return out;
});
const motivoNoGuardar = computed(() => {
  if (enEdicion.value) {
    if (!Object.keys(cambios.value).length) return 'No hay cambios que guardar';
    if (!nueva.fecha) return 'La fecha de la evolución no puede quedar vacía';
    return null;
  }
  return nuevaTieneContenido.value ? null : 'Escribe al menos hallazgos, diagnóstico, tratamiento u observaciones';
});

const motivoNoAgregar = computed(() => {
  if (!actual.value) return 'Todavía no hay una ficha: ábrela con «＋ Nueva consulta»';
  if (actual.value.estado === 'alta') return 'Esta ficha está de alta: abre una consulta nueva';
  if (formulario.value) return 'Ya estás agregando una evolución';
  return null;
});

const nuevaTieneContenido = computed(() =>
  [nueva.hallazgos, nueva.diagnostico, nueva.tratamiento, nueva.observaciones].some((v) => (v || '').trim()));

const resumen = computed(() => {
  if (!cargada.value) return 'fecha, quién atendió, diagnósticos, tratamiento y observaciones de cada cita';
  const n = fichas.value.length;
  if (!n) return 'sin fichas';
  const fichasTxt = n === 1 ? '1 ficha' : `${n} fichas`;
  return `${cuentaEvoluciones(actual.value)} en esta ficha · ${fichasTxt}`;
});

async function cargar() {
  if (!props.patientId) return;
  cargando.value = true; error.value = '';
  try {
    const r = await listarEvolucion(props.patientId);
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

function abrirFormulario() {
  Object.assign(nueva, vacia());
  enEdicion.value = null;
  errorNueva.value = '';
  formulario.value = true;
}

/** Abre el formulario con los datos de una evolución; `aControl` pone el foco en el próximo control. */
async function abrirEdicion(f, aControl = false) {
  if (!f || enviando.value) return;
  Object.assign(nueva, {
    fecha: f.fecha || hoyLocal(), hallazgos: f.hallazgos || '', diagnostico: f.diagnostico || '',
    tratamiento: f.tratamiento || '', observaciones: f.observaciones || '',
    proximoControlFecha: f.proximo_control_fecha || '', proximoControlMotivo: f.proximo_control_motivo || '',
  });
  enEdicion.value = f;
  errorNueva.value = '';
  formulario.value = true;
  await nextTick();
  formEl.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  if (aControl) controlEl.value?.focus?.();
}

function cerrarFormulario() {
  formulario.value = false;
  enEdicion.value = null;
}

async function guardarEvolucion() {
  if (!actual.value || motivoNoGuardar.value) return;
  const episodeId = actual.value.episode_id;
  enviando.value = true; errorNueva.value = '';
  try {
    if (enEdicion.value) {
      const f = enEdicion.value;
      await editarEvolucion(f.evolution_id
        ? { evolutionId: f.evolution_id, ...cambios.value }
        : { episodeId: f.episode_id, ...cambios.value });
      cerrarFormulario();
      emit('guardado', episodeId);
      await cargar();
      return;
    }
    await agregarEvolucion({
      episodeId,
      fecha: nueva.fecha || hoyLocal(),
      hallazgos: nueva.hallazgos.trim(),
      diagnostico: nueva.diagnostico.trim(),
      tratamiento: nueva.tratamiento.trim(),
      observaciones: nueva.observaciones.trim(),
      proximoControlFecha: nueva.proximoControlFecha,
      proximoControlMotivo: nueva.proximoControlMotivo.trim(),
    });
    cerrarFormulario();
    emit('guardado', episodeId);
    await cargar();
  } catch (e) {
    errorNueva.value = e?.message || 'No se pudo guardar la evolución';
  } finally {
    enviando.value = false;
  }
}

function editar(f) {
  editando.value = claveFila(f);
  borrador.value = f.observaciones || '';
  errorGuardar.value = '';
}

function cancelarEdicion() {
  editando.value = null;
  errorGuardar.value = '';
}

// Una evolución registrada guarda en ella (cepi-bot /api/bot/evolucion/editar). La fila
// armada va por el mismo camino que la sección 7 de la ficha (grupo g_7): solo viaja
// `observaciones`; el resto de la sección no se toca.
async function guardarObservaciones(f) {
  guardando.value = true; errorGuardar.value = '';
  try {
    const texto = borrador.value.trim();
    if (f.evolution_id) {
      await editarEvolucion({ evolutionId: f.evolution_id, observaciones: texto });
    } else {
      await guardarGrupoFicha({ groupId: 'g_7', data: { observaciones: texto }, episodeId: f.episode_id, patientId: props.patientId });
    }
    f.observaciones = texto || null;
    editando.value = null;
    emit('guardado', f.episode_id);
  } catch (e) {
    errorGuardar.value = e?.message || 'No se pudo guardar';
  } finally {
    guardando.value = false;
  }
}

watch(() => props.patientId, () => {
  filas.value = []; cargada.value = false; editando.value = null; formulario.value = false; verOtras.value = false;
  if (abierta.value) cargar();
});

// Otra ficha abierta: se cierran el formulario y la edición, que eran de la anterior.
watch(() => props.episodeId, () => { formulario.value = false; editando.value = null; });

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
.evo-btn--primario { color: #fff; background: #0284c7; border-color: #0284c7; }
.evo-btn--primario:hover:not(:disabled) { background: #0369a1; }
.evo-btn--primario:disabled { color: #f1f5f9; background: #cbd5e1; border-color: #cbd5e1; }
.evo-estado { margin: 0; padding: 4px 12px 12px; font-size: 13px; color: #64748b; }
.evo-error { color: #b91c1c; }

/* Cabecera de la ficha abierta. */
.evo-ficha { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
.evo-ficha-datos { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.evo-ficha-motivo { font-size: 14px; font-weight: 700; color: #0f172a; overflow-wrap: anywhere; }
.evo-ficha-meta { font-size: 12px; color: #475569; }
.evo-chip { display: inline-block; padding: 0 6px; font-size: 11px; font-weight: 600; color: #075985; background: #e0f2fe; border-radius: 999px; }
.evo-chip--alta { color: #166534; background: #dcfce7; }

/* Formulario de la evolución nueva. */
.evo-form { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-top: 1px solid #e2e8f0; background: #f0f9ff; }
.evo-campo { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: #334155; }
.evo-campo--corto { flex: 0 0 auto; max-width: 180px; }
.evo-campo input, .evo-campo textarea { box-sizing: border-box; width: 100%; padding: 6px 8px; font: inherit; font-size: 13px; font-weight: 400; color: #0f172a; background: #fff; border: 1px solid #94a3b8; border-radius: 6px; }
.evo-campo textarea { resize: vertical; }
.evo-fila { display: flex; gap: 10px; flex-wrap: wrap; }

.evo-scroll { max-height: 320px; overflow: auto; border-top: 1px solid #e2e8f0; }
.evo-tabla { width: 100%; border-collapse: collapse; font-size: 13px; }
.evo-tabla th { position: sticky; top: 0; padding: 7px 10px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.evo-tabla td { padding: 7px 10px; vertical-align: top; color: #0f172a; border-bottom: 1px solid #f1f5f9; white-space: pre-wrap; overflow-wrap: anywhere; }
.evo-fecha { white-space: nowrap; }
.evo-inicial { display: block; margin-top: 2px; font-size: 11px; color: #64748b; font-style: normal; white-space: nowrap; }
.evo-extra { display: block; margin-top: 3px; font-size: 12px; color: #475569; font-style: normal; }
.evo-obs { min-width: 160px; }
.evo-obs-linea { display: flex; align-items: flex-start; gap: 6px; }
.evo-obs-editar { flex-shrink: 0; margin-left: auto; padding: 0 4px; font-size: 14px; line-height: 1.4; font-style: normal; background: none; border: 0; border-radius: 4px; cursor: pointer; }
.evo-obs-editar:hover:not(:disabled) { background: #e0f2fe; }
.evo-obs-editar:disabled { opacity: .35; filter: grayscale(1); cursor: default; }
.evo-obs-texto { width: 100%; box-sizing: border-box; padding: 6px; font: inherit; font-size: 13px; border: 1px solid #94a3b8; border-radius: 6px; resize: vertical; }
.evo-obs-acciones { display: flex; gap: 6px; margin-top: 4px; }
.evo-obs-acciones .evo-btn { margin-left: 0; }
.evo-obs-error { margin: 4px 0 0; font-size: 12px; color: #b91c1c; font-style: normal; }
.evo-especialista { display: block; margin-top: 2px; font-size: 12px; color: #0369a1; }

/* Otras fichas del paciente. */
.evo-otras { padding: 6px 12px 10px; border-top: 1px solid #e2e8f0; }
.evo-otras-btn { padding: 4px 0; font-size: 13px; font-weight: 600; color: #0369a1; background: none; border: 0; cursor: pointer; }
.evo-otras-btn:disabled { color: #94a3b8; cursor: default; }
.evo-otras-lista { margin: 4px 0 0; padding: 0; list-style: none; }
.evo-otra { display: flex; flex-wrap: wrap; gap: 4px 10px; width: 100%; padding: 6px 8px; text-align: left; font: inherit; font-size: 13px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; margin-bottom: 4px; }
.evo-otra:hover { background: #f0f9ff; }
.evo-otra-motivo { font-weight: 600; color: #0f172a; }
.evo-otra-meta { color: #64748b; }

/* Como pestaña ocupa todo el alto: el cuerpo se desplaza dentro. */
.evo--pestana { display: flex; flex-direction: column; min-height: 0; height: 100%; margin: 0; border: 0; border-radius: 0; }
.evo--pestana .evo-cuerpo { flex: 1; min-height: 0; overflow: auto; }
.evo--pestana .evo-scroll { max-height: none; overflow: visible; }
/* Sin dato no es un error: en gris, como los grupos vacíos de la ficha. */
.evo-tabla td.evo-vacio { color: #94a3b8; font-style: italic; }

/* En el teléfono cada cita es una tarjeta: seis columnas no entran. */
@media (max-width: 560px) {
  .evo-cuenta { display: none; }
  .evo-ficha { flex-wrap: wrap; }
  .evo-campo--corto { max-width: none; }
  .evo-tabla thead { display: none; }
  .evo-tabla tr { display: block; padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
  .evo-tabla td { display: grid; grid-template-columns: 116px 1fr; gap: 8px; padding: 3px 12px; border: 0; }
  .evo-tabla td::before { content: attr(data-col); font-size: 12px; font-style: normal; color: #64748b; }
  .evo-tabla td > .evo-especialista, .evo-tabla td > .evo-extra, .evo-tabla td > .evo-inicial { grid-column: 2; }
}
.evo-control { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; margin-top: 10px; padding: 8px 10px; border-left: 4px solid #9CA3AF; background: rgba(0,0,0,0.03); border-radius: 4px; width: 100%; border-top: 0; border-right: 0; border-bottom: 0; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.evo-control:hover:not(:disabled) { background: rgba(0,0,0,0.06); }
.evo-control:disabled { cursor: default; }
.evo-control-editar { margin-left: auto; font-size: 14px; }
.evo-fila-tocable { cursor: pointer; }
.evo-fila-tocable:hover td { background: rgba(37,99,235,0.05); }
.evo-fila-editando td { background: rgba(37,99,235,0.10); }
.evo-form-titulo { margin: 0 0 4px; font-weight: 600; }
.evo-control--atrasado { border-left-color: #DC2626; }
.evo-control--atrasado .evo-control-estado { color: #DC2626; font-weight: 600; }
.evo-control--hoy { border-left-color: var(--accent, #2563EB); }
.evo-control--proximo { border-left-color: #16A34A; }
.evo-control-vacio { opacity: 0.7; }
</style>
