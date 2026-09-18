<template>
  <aside class="clist">
    <div class="clist-head">
      <input v-model="q" class="search" type="search" placeholder="Buscar paciente o cédula…" />
      <button class="reload" :disabled="busy" title="Refrescar" @click="load">↻</button>
    </div>

    <button class="newpat" @click="showCreate = !showCreate">＋ Nuevo paciente</button>
    <form v-if="showCreate" class="createform" @submit.prevent="create">
      <input v-model="cNombre" placeholder="Nombre *" autocomplete="off" />
      <input v-model="cApellido" placeholder="Apellido *" autocomplete="off" />
      <input v-model="cCedula" placeholder="Cédula *" autocomplete="off" />
      <div class="cf-actions">
        <button type="submit" :disabled="creating || !cNombre.trim() || !cApellido.trim() || !cCedula.trim()">{{ creating ? 'Creando…' : 'Crear' }}</button>
        <button type="button" class="cf-cancel" @click="showCreate = false">Cancelar</button>
      </div>
      <p v-if="createError" class="error">{{ createError }}</p>
    </form>

    <div class="rows" v-if="filtered.length">
      <button
        v-for="p in filtered"
        :key="p.id"
        class="row"
        :class="{ active: p.id === activeId, 'to-review': !!reviewQueue[p.id] }"
        @click="$emit('select', p)"
      >
        <span class="avatar">{{ initials(p) }}</span>
        <span class="info">
          <span class="name">{{ fullName(p) }}</span>
          <span class="cc">CC: {{ p.data?.cedula || '—' }}</span>
          <span v-if="assignments[p.id]?.assignee_name" class="acargo" :title="acargoMeta(p).title">
            {{ acargoMeta(p).icon }} {{ assignments[p.id].assignee_name }}
          </span>
        </span>
        <!-- Borrar un paciente es de supermédico (D-Aux-23). Quien no puede, no lo ve:
             es la excepción por permisos de la regla de no ocultar botones. -->
        <span
          v-if="puedeBorrar" class="borrar" role="button" tabindex="0"
          title="Eliminar paciente" @click.stop="pedirBorrado(p)" @keydown.enter.stop="pedirBorrado(p)"
        >🗑</span>
        <span
          v-if="reviewQueue[p.id]"
          class="rev-badge"
          :title="`${reviewQueue[p.id].pending} pendiente(s) de revisión derivadas a ti`"
        >🔔 revisar</span>
      </button>
    </div>
    <!-- "No hay pacientes" solo con la lista YA recibida: antes salía al abrir, antes de la
         primera carga, y se leía como una org vacía. -->
    <p v-else-if="!cargado && !error" class="empty">Cargando pacientes…</p>
    <p v-else-if="!busy && cargado" class="empty">{{ q ? 'Sin coincidencias' : 'No hay pacientes' }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { listPatients, createPatient, getReviewQueue, getPatientAssignments, eliminarPaciente } from '../api.js';

const props = defineProps({
  activeId: { type: String, default: null },
  generalActive: { type: Boolean, default: false },
  /** La sesión, para saber si esta cuenta puede borrar pacientes. */
  user: { type: Object, default: null },
});
const emit = defineEmits(['select', 'general']);

const DEF_PACIENTE = '11000000-0000-0000-0000-000000000000';
const puedeBorrar = computed(() => {
  const permisos = props.user?.permissions || [];
  return permisos.includes('*:*:*:*') || permisos.includes(`entity:${DEF_PACIENTE}:record:delete`);
});
const borrando = ref('');

/** Confirmar antes: el paciente desaparece de las listas (la historia clínica se conserva). */
async function pedirBorrado(p) {
  const nombre = fullName(p);
  const texto = `¿Eliminar a ${nombre}?\n\nDeja de aparecer en las listas. Su historia clínica se conserva, y si se lo crea de nuevo con la misma cédula vuelve con lo que tenía.`;
  if (!window.confirm(texto)) return;
  borrando.value = p.id;
  try {
    await eliminarPaciente(p.id);
    all.value = all.value.filter((x) => x.id !== p.id);
  } catch (e) {
    error.value = `No se pudo eliminar a ${nombre}: ${e?.message || e}`;
  } finally {
    borrando.value = '';
  }
}

const all = ref([]);
const reviewQueue = ref({});   // { patientId: { pending, earliest_due } } — derived to me
const assignments = ref({});   // { patientId: { assignee_name, source, ... } } — a cargo

// Icono + tooltip según cómo quedó "a cargo" el responsable.
function acargoMeta(p) {
  const a = assignments.value[p.id] || {};
  if (a.source === 'derivado_grupo') return { icon: '👥', title: 'Derivado al círculo (pendiente de revisión)' };
  if (a.source === 'derivado') return { icon: '↪️', title: 'Derivado a (pendiente de revisión)' };
  if (a.source === 'creador') return { icon: '👤', title: 'Médico que creó el caso' };
  return { icon: '🩺', title: 'Responsable del caso' };
}
const q = ref('');
const busy = ref(false);
const cargado = ref(false);   // la lista llegó al menos una vez
const error = ref('');

const showCreate = ref(false);
const cNombre = ref('');
const cApellido = ref('');
const cCedula = ref('');
const creating = ref(false);
const createError = ref('');

async function create() {
  if (!cNombre.value.trim() || !cApellido.value.trim() || !cCedula.value.trim()) return;
  creating.value = true;
  createError.value = '';
  try {
    const p = await createPatient({ nombre: cNombre.value.trim(), apellidos: cApellido.value.trim(), cedula: cCedula.value.trim() });
    cNombre.value = '';
    cApellido.value = '';
    cCedula.value = '';
    showCreate.value = false;
    await load();
    if (p?.id) emit('select', p);
  } catch (e) {
    createError.value = e.message || String(e);
  } finally {
    creating.value = false;
  }
}

function fullName(p) {
  return [p.data?.nombre, p.data?.apellidos].filter(Boolean).join(' ') || p.title || 'Paciente';
}
function initials(p) {
  const n = fullName(p);
  return n.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

const filtered = computed(() => {
  const t = q.value.trim().toLowerCase();
  let list = all.value;
  if (t) list = all.value.filter(p => {
    const n = fullName(p).toLowerCase();
    const c = String(p.data?.cedula || '').toLowerCase();
    return n.includes(t) || c.includes(t);
  });
  // Patients with items pending my review (derived to me) come first, soonest
  // due first; everyone else keeps their original order.
  const rq = reviewQueue.value;
  return list.map((p, i) => ({ p, i })).sort((a, b) => {
    const ra = rq[a.p.id], rb = rq[b.p.id];
    if (ra && !rb) return -1;
    if (!ra && rb) return 1;
    if (ra && rb) {
      const da = ra.earliest_due ? new Date(ra.earliest_due).getTime() : Infinity;
      const db = rb.earliest_due ? new Date(rb.earliest_due).getTime() : Infinity;
      if (da !== db) return da - db;
    }
    return a.i - b.i;
  }).map(x => x.p);
});

async function load(silent = false) {
  if (!silent) { busy.value = true; error.value = ''; }
  try {
    const r = await listPatients({});
    all.value = Array.isArray(r?.data) ? r.data : [];
    cargado.value = true;
    try {
      const rq = await getReviewQueue();
      reviewQueue.value = rq?.by_patient || {};
    } catch { /* keep previous queue on transient error */ }
    try {
      const as = await getPatientAssignments();
      assignments.value = as?.assignments || {};
    } catch { /* keep previous assignments on transient error */ }
  } catch (e) {
    if (!silent) error.value = e.message || String(e);
  } finally {
    if (!silent) busy.value = false;
  }
}

// Poll en segundo plano para que las derivaciones recibidas aparezcan en la
// lista (arriba, con badge "revisar") sin tener que refrescar a mano.
let pollTimer = null;
onMounted(() => {
  load();
  pollTimer = setInterval(() => load(true), 20000);
});
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); });
defineExpose({ reload: load });
</script>

<style scoped>
.clist {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: #fff; border: 1px solid var(--border); border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.clist-head { display: flex; gap: 6px; padding: 10px; border-bottom: 1px solid var(--border); }
.search {
  flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 20px;
  background: var(--bg); color: var(--text); font-size: 14px; outline: none;
}
.search:focus { border-color: var(--accent); }
.reload { width: 36px; border: 1px solid var(--border); border-radius: 50%; background: var(--bg); color: var(--accent); cursor: pointer; }
.rows { flex: 1; min-height: 0; overflow-y: auto; }
.row, .general {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: none; border-bottom: 1px solid var(--border);
  background: transparent; color: var(--text); cursor: pointer; text-align: left;
  transition: background 0.12s;
}
.row:hover, .general:hover { background: var(--bg); }
.row.active, .general.active { background: var(--accent-band, #e8f3f8); }
.row.to-review { background: #fff7ed; box-shadow: inset 3px 0 0 #f97316; }
.row.to-review.active { background: var(--accent-band, #e8f3f8); }
.borrar {
  flex-shrink: 0; padding: 2px 6px; font-size: 13px; line-height: 1.2; color: #b91c1c;
  background: #fee2e2; border-radius: 6px; cursor: pointer; opacity: .65;
}
.borrar:hover { opacity: 1; }
.rev-badge {
  flex-shrink: 0; margin-left: auto; align-self: center;
  background: #f97316; color: #fff; border-radius: 12px;
  padding: 2px 8px; font-size: 0.66rem; font-weight: 800; white-space: nowrap;
}
.general { border-bottom: 6px solid var(--bg); }
.avatar {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent); color: #fff; font-weight: 700; font-size: 0.85rem;
}
.avatar.gen { background: var(--text-muted); }
.info { display: flex; flex-direction: column; min-width: 0; }
.name { font-weight: 600; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc { font-size: 0.78rem; color: var(--text-muted); }
.acargo { font-size: 0.76rem; color: var(--accent); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.newpat {
  margin: 8px 10px 4px; padding: 9px; border: none; border-radius: 20px;
  background: var(--accent); color: #fff; font-weight: 700; font-size: 0.88rem; cursor: pointer;
}
.createform { display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 10px; border-bottom: 1px solid var(--border); }
.createform input { padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 14px; }
.cf-actions { display: flex; gap: 6px; }
.cf-actions button { flex: 1; padding: 7px; border: none; border-radius: 6px; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
.cf-actions button[disabled] { opacity: .55; cursor: not-allowed; }
.cf-actions .cf-cancel { background: var(--bg); color: var(--text-muted); border: 1px solid var(--border); }
.empty, .error { padding: 14px; color: var(--text-muted); font-size: 14px; }
.error { color: #dc2626; }
</style>
