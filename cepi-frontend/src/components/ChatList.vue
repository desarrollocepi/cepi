<template>
  <aside class="clist">
    <div class="clist-head">
      <input v-model="q" class="search" type="search" placeholder="Buscar paciente o cédula…" />
      <button class="reload" :disabled="busy" title="Refrescar" @click="load">↻</button>
    </div>

    <!-- Los estados de la ficha como filtro, debajo del buscador (PAPER §24.2.1). Cada botón
         lleva su LED y cuántos pacientes hay: es también la leyenda de los colores. Un estado
         sin pacientes se ve gris, no se esconde. Tocar el elegido lo suelta. -->
    <div class="filtros" role="group" aria-label="Filtrar por estado de la ficha">
      <button
        type="button" class="filtro" :class="{ on: !estadoElegido }" :disabled="!cargado || verArchivados"
        :aria-pressed="!estadoElegido" @click="estadoElegido = ''"
      >Todos · {{ all.length }}</button>
      <button
        v-for="e in ESTADOS_FICHA" :key="e.id" type="button" class="filtro"
        :class="{ on: estadoElegido === e.id }" :aria-pressed="estadoElegido === e.id"
        :disabled="!cargado || verArchivados || (!conteo[e.id] && estadoElegido !== e.id)"
        :title="conteo[e.id] ? `Ver solo «${e.etiqueta}»` : `Ningún paciente en «${e.etiqueta}»`"
        @click="estadoElegido = estadoElegido === e.id ? '' : e.id"
      ><span class="led" :class="{ hueco: e.hueco }" :style="{ '--led': e.color }" />{{ e.etiqueta }} · {{ conteo[e.id] || 0 }}</button>
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

    <!-- Los archivados (D-Aux-23): la misma lista en otro modo, con «Restaurar» en cada fila.
         Entrar es de quien puede archivar; quien no, no ve el botón (excepción por permisos). -->
    <button
      v-if="puedeBorrar" type="button" class="verarch" :aria-pressed="verArchivados"
      @click="alternarArchivados()"
    >{{ verArchivados ? '‹ Volver a los pacientes' : '🗄️ Ver los archivados' }}</button>

    <template v-if="verArchivados">
      <div v-if="archivadosFiltrados.length" class="rows">
        <div v-for="p in archivadosFiltrados" :key="p.id" class="row arch">
          <span class="avatar gen">{{ initials(p) }}</span>
          <span class="info">
            <span class="name">{{ fullName(p) }}</span>
            <span class="cc">CC: {{ p.data?.cedula || '—' }}</span>
          </span>
          <button
            type="button" class="restaurar" :disabled="!!restaurando"
            :title="restaurando ? 'Espera a que termine la restauración en curso' : `Devolver a ${fullName(p)} a la lista`"
            @click="restaurar(p)"
          >{{ restaurando === p.id ? 'Restaurando…' : 'Restaurar' }}</button>
        </div>
      </div>
      <p v-else-if="cargandoArchivados" class="empty">Cargando archivados…</p>
      <p v-else-if="!errorArchivados" class="empty">{{ q.trim() ? 'Sin coincidencias' : 'No hay pacientes archivados' }}</p>
      <p v-if="errorArchivados" class="error">
        {{ errorArchivados }}
        <button type="button" class="reintentar" :disabled="cargandoArchivados" @click="cargarArchivados()">Reintentar</button>
      </p>
    </template>

    <div class="rows" v-else-if="filtered.length">
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
            {{ acargoMeta(p).icon }} {{ acargoMeta(p).texto }}
          </span>
        </span>
        <!-- Las acciones del paciente, en un menú: lo que antes era un basurero suelto. -->
        <span
          class="acciones" role="button" tabindex="0" aria-haspopup="menu"
          :aria-expanded="menu?.p.id === p.id" :aria-label="`Acciones de ${fullName(p)}`" title="Acciones"
          @click.stop="alternarMenu(p, $event)" @keydown.enter.stop.prevent="alternarMenu(p, $event)"
        >⋯</span>
        <span
          v-if="reviewQueue[p.id]"
          class="rev-badge"
          :title="`${reviewQueue[p.id].pending} pendiente(s) de revisión derivadas a ti`"
        >🔔 revisar</span>
        <!-- El estado de la ficha actual: al costado y no en una línea más, para que la
             fila no crezca. -->
        <span
          class="led" :class="{ hueco: estadoDe(p).hueco }" :style="{ '--led': estadoDe(p).color }"
          role="img" :title="`Ficha: ${estadoDe(p).etiqueta}`" :aria-label="`Ficha: ${estadoDe(p).etiqueta}`"
        />
      </button>
    </div>
    <!-- "No hay pacientes" solo con la lista YA recibida: antes salía al abrir, antes de la
         primera carga, y se leía como una org vacía. -->
    <p v-else-if="!cargado && !error" class="empty">Cargando pacientes…</p>
    <p v-else-if="!busy && cargado" class="empty">{{ vacio }}</p>
    <p v-if="error && !verArchivados" class="error">
      {{ error }}
      <button type="button" class="reintentar" :disabled="busy" @click="load()">Reintentar</button>
    </p>

    <!-- Un solo menú para toda la lista, fuera de las filas (que son botones) y fijo a la
         ventana: dentro de `.rows` lo recortaría el scroll. -->
    <div
      v-if="menu" class="menu" role="menu" :aria-label="`Acciones de ${fullName(menu.p)}`"
      :style="menu.estilo" @click.stop
    >
      <button type="button" role="menuitem" @click="abrir('chat')">💬 Abrir el chat</button>
      <button type="button" role="menuitem" @click="abrir('ficha')">📋 Ver la ficha</button>
      <button type="button" role="menuitem" @click="abrir('imagenes')">🖼️ Ver las imágenes</button>
      <button
        type="button" role="menuitem" :disabled="!menu.p.data?.cedula"
        :title="menu.p.data?.cedula ? '' : 'Este paciente no tiene cédula registrada'"
        @click="copiarCedula()"
      >📎 Copiar la cédula</button>
      <!-- Archivar es de supermédico (D-Aux-23). Quien no puede, no lo ve: es la excepción
           por permisos de la regla de no ocultar botones. -->
      <button
        v-if="puedeBorrar" type="button" role="menuitem" class="archivar"
        :disabled="borrando === menu.p.id" @click="pedirArchivado()"
      >🗄️ Archivar paciente</button>
    </div>
    <p v-if="aviso" class="aviso" role="status">{{ aviso }}</p>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  listPatients, createPatient, getReviewQueue, getPatientAssignments, eliminarPaciente,
  listarPacientesArchivados, restaurarPaciente,
} from '../api.js';
import { ESTADOS_FICHA, estadoFicha, normalizar } from '../estadoFicha.js';

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

// ── Menú de acciones de una fila ──
const menu = ref(null);   // { p, estilo } | null
const aviso = ref('');
let avisoTimer = null;

function alternarMenu(p, ev) {
  if (menu.value?.p.id === p.id) { menu.value = null; return; }
  const r = ev.currentTarget.getBoundingClientRect();
  const right = `${Math.max(8, window.innerWidth - r.right)}px`;
  // En las últimas filas no cabe hacia abajo: se abre hacia arriba.
  const arriba = r.bottom + 240 > window.innerHeight;
  menu.value = {
    p,
    estilo: arriba ? { bottom: `${window.innerHeight - r.top + 4}px`, right } : { top: `${r.bottom + 4}px`, right },
  };
}
function cerrarMenu() { menu.value = null; }
function alTeclear(e) { if (e.key === 'Escape') cerrarMenu(); }

function abrir(seccion) {
  const p = menu.value.p;
  cerrarMenu();
  emit('select', p, seccion);
}

function avisar(texto) {
  aviso.value = texto;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { aviso.value = ''; }, 2500);
}

async function copiarCedula() {
  const p = menu.value.p;
  cerrarMenu();
  try {
    await navigator.clipboard.writeText(String(p.data.cedula));
    avisar(`Cédula de ${fullName(p)} copiada`);
  } catch {
    error.value = `No se pudo copiar. La cédula es ${p.data.cedula}.`;
  }
}

/** Archivar es el borrado suave del ERP: el paciente sale de las listas y la historia
 *  clínica se conserva. Se confirma antes. */
async function pedirArchivado() {
  const p = menu.value.p;
  cerrarMenu();
  const nombre = fullName(p);
  const texto = `¿Archivar a ${nombre}?\n\nDeja de aparecer en las listas. Su historia clínica se conserva, y si se lo crea de nuevo con la misma cédula vuelve con lo que tenía.`;
  if (!window.confirm(texto)) return;
  borrando.value = p.id;
  try {
    await eliminarPaciente(p.id);
    all.value = all.value.filter((x) => x.id !== p.id);
    avisar(`${nombre} quedó archivado`);
  } catch (e) {
    error.value = `No se pudo archivar a ${nombre}: ${e?.message || e}`;
  } finally {
    borrando.value = '';
  }
}

// ── Archivados ──
const verArchivados = ref(false);
const archivados = ref([]);
const cargandoArchivados = ref(false);
const errorArchivados = ref('');
const restaurando = ref('');
const archivadosFiltrados = computed(() => {
  const t = normalizar(q.value.trim());
  return archivados.value.filter((p) => !t || normalizar(`${fullName(p)} ${p.data?.cedula || ''}`).includes(t));
});

function alternarArchivados() {
  verArchivados.value = !verArchivados.value;
  cerrarMenu();
  if (verArchivados.value) cargarArchivados();
}

async function cargarArchivados() {
  cargandoArchivados.value = true;
  errorArchivados.value = '';
  try {
    const r = await listarPacientesArchivados();
    archivados.value = Array.isArray(r?.data) ? r.data : [];
  } catch (e) {
    errorArchivados.value = `No se pudieron cargar los archivados: ${e?.message || e}`;
  } finally {
    cargandoArchivados.value = false;
  }
}

async function restaurar(p) {
  const nombre = fullName(p);
  restaurando.value = p.id;
  errorArchivados.value = '';
  try {
    await restaurarPaciente(p.id);
    archivados.value = archivados.value.filter((x) => x.id !== p.id);
    avisar(`${nombre} volvió a la lista`);
    load(true);
  } catch (e) {
    errorArchivados.value = `No se pudo restaurar a ${nombre}: ${e?.message || e}`;
  } finally {
    restaurando.value = '';
  }
}

const all = ref([]);
const reviewQueue = ref({});   // { patientId: { pending, earliest_due } } — derived to me
const assignments = ref({});   // { patientId: { assignee_name, source, estado, ... } } — a cargo
const estadoElegido = ref(''); // id de ESTADOS_FICHA, o '' = todos

function estadoDe(p) { return estadoFicha(assignments.value[p.id]?.estado); }
/** Cuántos pacientes hay en cada estado: el filtro los muestra y deshabilita los vacíos. */
const conteo = computed(() => {
  const c = {};
  for (const p of all.value) { const id = estadoDe(p).id; c[id] = (c[id] || 0) + 1; }
  return c;
});
const vacio = computed(() => {
  if (q.value.trim()) return 'Sin coincidencias';
  const e = ESTADOS_FICHA.find((x) => x.id === estadoElegido.value);
  return e ? `Ningún paciente en «${e.etiqueta}». Elige otro estado o «Todos».` : 'No hay pacientes';
});

// Icono, texto y tooltip de "a cargo". Si el caso está derivado a varias personas se
// nombran todas (hasta dos, y el resto como "+N"): con una sola derivación visible no se
// sabía que había más gente mirando el caso.
function acargoMeta(p) {
  const a = assignments.value[p.id] || {};
  const derivados = (a.derivados || []).map(d => d.name).filter(Boolean);
  const varios = derivados.length > 1;
  const texto = varios
    ? (derivados.length > 2 ? `${derivados.slice(0, 2).join(', ')} +${derivados.length - 2}` : derivados.join(', '))
    : a.assignee_name;
  const detalle = varios ? ` — derivado a ${derivados.join(', ')}` : '';
  if (a.source === 'derivado_grupo') return { icon: '👥', texto, title: 'Derivado al círculo (pendiente de revisión)' + detalle };
  if (a.source === 'derivado') return { icon: '↪️', texto, title: 'Derivado a (pendiente de revisión)' + detalle };
  if (a.source === 'creador') return { icon: '👤', texto, title: 'Médico que creó el caso' + detalle };
  return { icon: '🩺', texto, title: 'Responsable del caso' + detalle };
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

// Por texto (nombre o cédula, sin tildes) y, si se eligió, por estado de la ficha. El orden
// es el de `ordenar` en PacientesModelo.swift: por estado; dentro de un mismo estado, primero
// lo derivado a quien consulta, lo que vence antes arriba; el resto conserva el del servidor.
const filtered = computed(() => {
  const t = normalizar(q.value.trim());
  const elegido = estadoElegido.value;
  const rq = reviewQueue.value;
  return all.value
    .map((p, i) => ({ p, i, estado: estadoDe(p) }))
    .filter(({ p, estado }) =>
      (!t || normalizar(`${fullName(p)} ${p.data?.cedula || ''}`).includes(t))
      && (!elegido || estado.id === elegido))
    .sort((a, b) => {
      if (a.estado.orden !== b.estado.orden) return a.estado.orden - b.estado.orden;
      const ra = rq[a.p.id], rb = rq[b.p.id];
      if (ra && !rb) return -1;
      if (!ra && rb) return 1;
      if (ra && rb) {
        const da = ra.earliest_due ? new Date(ra.earliest_due).getTime() : Infinity;
        const db = rb.earliest_due ? new Date(rb.earliest_due).getTime() : Infinity;
        if (da !== db) return da - db;
      }
      return a.i - b.i;
    })
    .map((x) => x.p);
});

async function load(silent = false) {
  if (!silent) { busy.value = true; error.value = ''; }
  try {
    // Los tres en paralelo. Si fallan los dos accesorios se conserva lo anterior: un error
    // transitorio no debe borrar los avisos de "revisar" ni los estados.
    const [r, rq, as] = await Promise.all([
      listPatients({}),
      getReviewQueue().catch(() => null),
      getPatientAssignments().catch(() => null),
    ]);
    if (rq) reviewQueue.value = rq.by_patient || {};
    if (as) assignments.value = as.assignments || {};
    all.value = Array.isArray(r?.data) ? r.data : [];
    cargado.value = true;
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
  // El menú se cierra al tocar fuera, con Escape o al desplazar la lista (va fijo a la
  // ventana y se quedaría flotando lejos de su fila).
  document.addEventListener('click', cerrarMenu);
  document.addEventListener('keydown', alTeclear);
  window.addEventListener('scroll', cerrarMenu, true);
  window.addEventListener('resize', cerrarMenu);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  clearTimeout(avisoTimer);
  document.removeEventListener('click', cerrarMenu);
  document.removeEventListener('keydown', alTeclear);
  window.removeEventListener('scroll', cerrarMenu, true);
  window.removeEventListener('resize', cerrarMenu);
});
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
.filtros {
  display: flex; gap: 6px; padding: 8px 10px; overflow-x: auto; flex-shrink: 0;
  border-bottom: 1px solid var(--border); scrollbar-width: thin;
}
.filtro {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  padding: 5px 11px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--bg); color: var(--text); font-size: 0.78rem; font-weight: 600;
  white-space: nowrap; cursor: pointer;
}
.filtro.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.filtro:disabled { opacity: .45; cursor: not-allowed; }
.led {
  flex-shrink: 0; width: 12px; height: 12px; border-radius: 50%;
  background: var(--led); box-sizing: border-box;
}
.led.hueco { background: transparent; border: 2px solid var(--led); }
.filtro .led { width: 10px; height: 10px; }
.filtro.on .led { box-shadow: 0 0 0 1.5px #fff; }
.reintentar {
  margin-left: 8px; padding: 4px 12px; border: none; border-radius: 6px;
  background: var(--accent); color: #fff; font-weight: 600; font-size: 0.8rem; cursor: pointer;
}
.reintentar:disabled { opacity: .55; cursor: not-allowed; }
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
.acciones {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; line-height: 1; color: var(--text-muted); cursor: pointer;
}
.acciones:hover, .acciones[aria-expanded="true"] { background: var(--border); color: var(--text); }
.menu {
  position: fixed; z-index: 1200; min-width: 200px; padding: 4px;
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.14);
}
.menu button {
  padding: 9px 12px; border: none; border-radius: 6px; background: transparent;
  color: var(--text); font-size: 0.88rem; text-align: left; cursor: pointer;
}
.menu button:hover:not(:disabled) { background: var(--bg); }
.menu button:disabled { opacity: .45; cursor: not-allowed; }
.menu .archivar { margin-top: 4px; border-top: 1px solid var(--border); border-radius: 0 0 6px 6px; color: #b45309; }
.aviso {
  margin: 0; padding: 8px 14px; border-top: 1px solid var(--border);
  background: #f0fdf4; color: #166534; font-size: 0.82rem;
}
.verarch {
  margin: 2px 10px 6px; padding: 7px; border: 1px solid var(--border); border-radius: 20px;
  background: var(--bg); color: var(--text-muted); font-weight: 600; font-size: 0.82rem; cursor: pointer;
}
.verarch[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }
.row.arch { cursor: default; }
.row.arch:hover { background: transparent; }
.restaurar {
  flex-shrink: 0; padding: 6px 12px; border: 1px solid var(--accent); border-radius: 16px;
  background: #fff; color: var(--accent); font-weight: 700; font-size: 0.8rem; cursor: pointer;
}
.restaurar:disabled { opacity: .5; cursor: not-allowed; }
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
.info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
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
