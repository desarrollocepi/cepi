<template>
  <div class="shell" :class="`shell--${view}`">
    <ChatList
      class="shell-list"
      :user="user"
      :active-id="selectedId"
      :general-active="generalActive"
      @select="onSelect"
      @general="onGeneral"
    />
    <div class="shell-detail">
      <!-- Dentro del paciente hay tres secciones (PAPER §24.2.1, D-Aux-22): las mismas que
           en la app iOS, donde además se pasan deslizando. -->
      <nav v-if="selectedId" class="shell-secciones" role="tablist">
        <button
          v-for="s in SECCIONES" :key="s.id" role="tab"
          :aria-selected="seccion === s.id" :class="{ on: seccion === s.id }"
          @click="irASeccion(s.id)"
        >{{ s.label }}</button>
      </nav>

      <!-- El chat queda montado: cambiar de sección no debe perder lo escrito. -->
      <IntakeChat
        v-show="seccion === 'chat'"
        ref="chatRef" :user="user" class="shell-chat"
        @closed="onChatClosed" @back="volverALista" @head="patientActive = $event"
      />
      <FichaCompleta
        v-if="selectedId && seccion === 'ficha'"
        :key="selectedId" :patient-id="selectedId" :episode-id="episodioDeLaFicha"
        :visitas="visitas" :cargando-visitas="cargandoVisitas"
        class="shell-chat" @navegar="episodioElegido = $event"
      />
      <RejillaImagenes
        v-if="selectedId && seccion === 'imagenes'"
        :key="selectedId" :patient-id="selectedId" :mostrar-paciente="false"
        vacio="Este paciente todavía no tiene imágenes"
        class="shell-chat"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import ChatList from './ChatList.vue';
import IntakeChat from './IntakeChat.vue';
import FichaCompleta from './FichaCompleta.vue';
import RejillaImagenes from './RejillaImagenes.vue';
import { listarCasosDePaciente, obtenerEntidad } from '../api.js';
import { bindBackState } from '../useBackStack.js';
import { useRoute, useRouter } from 'vue-router';

defineProps({ user: Object });
const emit = defineEmits(['head', 'aviso']);

const view = ref('list');          // mobile only: 'list' | 'chat' (desktop shows both)
const patientActive = ref(false);  // IntakeChat tiene un paciente abierto (header + su burger)
// El burger del chat solo es VISIBLE con paciente abierto y en la vista de chat.
// Al volver a la lista (view='list') esto cae a false y el topbar recupera su burger.
const headActive = computed(() => patientActive.value && view.value === 'chat');
watch(headActive, (v) => emit('head', v), { immediate: true });
const selectedId = ref(null);
const selectedName = ref('');
const generalActive = ref(false);

const SECCIONES = [
  { id: 'chat', label: '💬 Chat' },
  { id: 'ficha', label: '📋 Ficha' },
  { id: 'imagenes', label: '🖼️ Imágenes' },
];
const seccion = ref('chat');
const visitas = ref([]);
const cargandoVisitas = ref(false);
let visitasDe = null;
/** La ficha abre en la consulta más reciente; dentro se navega entre visitas («‹ Anterior»
 *  y «Siguiente ›» emiten `navegar`). Sin recogerlo, los botones se habilitaban y no hacían
 *  nada. La elección vale mientras siga siendo una visita de este paciente. */
const episodioElegido = ref(null);
const episodioDeLaFicha = computed(() => {
  const elegida = visitas.value.find((v) => v.id === episodioElegido.value);
  return (elegida || visitas.value[0])?.id || null;
});

/** Las visitas del paciente, para la sección Ficha. Un fallo no se muestra como "sin fichas". */
async function cargarVisitas(patientId) {
  if (!patientId || visitasDe === patientId) return;
  cargandoVisitas.value = true;
  try {
    const data = (await listarCasosDePaciente(patientId)).data || [];
    if (selectedId.value !== patientId) return;   // se cambió de paciente mientras cargaba
    visitas.value = data;
    visitasDe = patientId;
  } catch {
    if (selectedId.value !== patientId) return;
    visitas.value = [];
    visitasDe = null;
  } finally {
    if (selectedId.value === patientId) cargandoVisitas.value = false;
  }
}

watch([selectedId, seccion], ([id, s]) => {
  if (id && s === 'ficha') cargarVisitas(id);
});

const chatRef = ref(null);

const mq = window.matchMedia('(max-width: 768px)');
const isMobile = ref(mq.matches);
const onMq = (e) => { isMobile.value = e.matches; if (!e.matches) view.value = 'list'; };

function fullName(p) {
  return [p.data?.nombre, p.data?.apellidos].filter(Boolean).join(' ') || p.title || 'Paciente';
}

// ── El paciente abierto lo manda la RUTA (`#/chat/<uuid>[/ficha|/imagenes]`) ──
// Elegir un paciente NAVEGA y `aplicarRuta` es el único sitio que lo abre o lo
// cierra: así el enlace se puede compartir, la recarga no lo pierde y el atrás del
// navegador cambia de paciente o vuelve a la lista sin código aparte.
const route = useRoute();
const router = useRouter();
const DEF_PACIENTE = '11000000-0000-0000-0000-000000000000';
/** id → nombre de los pacientes que ya se abrieron en esta carga: vienen de la lista
 *  o ya se validaron contra la API, así que al volver a ellos no se pregunta otra vez. */
const conocidos = new Map();

function rutaDePaciente(id, s) {
  return { name: 'chat-paciente', params: { patientId: id, ...(s && s !== 'chat' ? { seccion: s } : {}) } };
}

/** `s` llega del menú de acciones de la lista («Ver la ficha», «Ver las imágenes»); una
 *  fila tocada a secas abre el chat. */
function onSelect(p, s = 'chat') {
  conocidos.set(p.id, fullName(p));
  if (s !== 'chat') {
    if (p.id === selectedId.value) irASeccion(s);
    else router.push(rutaDePaciente(p.id, s));
    return;
  }
  if (p.id === selectedId.value) {
    // Ya está abierto (en la lista del escritorio se puede volver a tocar): se recarga
    // el hilo como antes, sin sumar una entrada repetida al historial.
    openPatientById(p.id, fullName(p));
    if (seccionDeLaRuta() !== 'chat') router.replace(rutaDePaciente(p.id));
    return;
  }
  router.push(rutaDePaciente(p.id));
}

/** Cambiar de sección REEMPLAZA la entrada: el atrás vuelve al paciente anterior o a
 *  la lista, no recorre las pestañas que se fueron tocando. */
function irASeccion(s) {
  if (selectedId.value) router.replace(rutaDePaciente(selectedId.value, s));
}

function onGeneral() {
  // El chat general no tiene URL propia: es `/chat` a secas.
  if (selectedId.value) router.push('/chat');
  selectedId.value = null;
  selectedName.value = '';
  seccion.value = 'chat';
  generalActive.value = true;
  chatRef.value?.newGeneral();
  if (isMobile.value) view.value = 'chat';
}

// IntakeChat avisa que se cerró (p.ej. tras derivar) → deseleccionar el paciente
// y, en móvil, volver a la lista para elegir otro.
function onChatClosed() {
  const habiaPaciente = !!selectedId.value;
  selectedId.value = null;
  selectedName.value = '';
  seccion.value = 'chat';
  generalActive.value = false;
  if (isMobile.value) view.value = 'list';
  // La URL deja de nombrar al paciente; se reemplaza para que el atrás no lo reabra.
  if (habiaPaciente && route.name === 'chat-paciente') router.replace('/chat');
}

/** «‹» del encabezado del chat (móvil). Con paciente, volver a la lista es salir de su
 *  URL: si se llegó desde la lista se deshace esa entrada —así el atrás del teléfono
 *  no lo reabre—, y si se entró directo por el enlace se reemplaza. */
function volverALista() {
  if (!selectedId.value) { view.value = 'list'; return; }
  if (window.history.state?.back === '/chat') router.back();
  else router.replace('/chat');
}

// Abre el paciente en pantalla. No toca la URL: lo llama `aplicarRuta`.
function openPatientById(id, name) {
  // Con la sección en la URL se puede caer directo en la Ficha de OTRO paciente
  // (atrás/adelante): nada de las visitas del anterior mientras llegan las de este.
  if (visitasDe !== id) { visitas.value = []; visitasDe = null; }
  seccion.value = 'chat';
  selectedId.value = id;
  selectedName.value = name || '';
  generalActive.value = false;
  chatRef.value?.openPatient(id, name || 'Paciente');
  if (isMobile.value) view.value = 'chat';
}

/** La ruta ya no nombra a ningún paciente: se suelta el que estaba abierto. */
function cerrarPaciente() {
  selectedId.value = null;
  selectedName.value = '';
  seccion.value = 'chat';
  if (isMobile.value) view.value = 'list';
  chatRef.value?.newGeneral();
}

function seccionDeLaRuta() {
  const s = route.params.seccion;
  return SECCIONES.some((x) => x.id === s) ? s : 'chat';
}

/** Pinta lo que diga la ruta. */
async function aplicarRuta() {
  // Al salir hacia otra vista (perfil, casos…) el watcher aún alcanza a correr.
  if (route.name !== 'chat' && route.name !== 'chat-paciente') return;

  // Enlaces viejos `#/chat?paciente=<id>` (notificaciones ya entregadas).
  if (route.query.paciente) {
    router.replace(rutaDePaciente(String(route.query.paciente)));
    return;
  }

  const id = route.params.patientId ? String(route.params.patientId) : null;
  if (!id) {
    if (selectedId.value) cerrarPaciente();
    return;
  }
  if (id !== selectedId.value) {
    let nombre = conocidos.get(id);
    if (!nombre) {
      // Recarga, enlace compartido o notificación: el id viene de fuera. Se valida y
      // se resuelve el nombre ANTES de abrir, para no activar en el bot un paciente
      // que no existe o que es de otra organización.
      try {
        const rec = await obtenerEntidad(id);
        if (rec?.entity_id !== DEF_PACIENTE) throw new Error('no es un paciente');
        nombre = fullName(rec);
        conocidos.set(id, nombre);
      } catch (e) {
        if (route.params.patientId !== id) return;   // ya se navegó a otra parte
        // Solo un 403/404 (o un id que es de otra cosa) dice que no está al alcance;
        // sin red o con un 5xx no se puede afirmar que no exista.
        const ajeno = e?.status === 403 || e?.status === 404 || e?.message === 'no es un paciente';
        emit('aviso', ajeno
          ? 'Ese paciente no existe o no pertenece a tu organización activa.'
          : 'No se pudo abrir el paciente. Reintenta desde la lista.');
        router.replace('/chat');
        return;
      }
      if (route.params.patientId !== id) return;     // ya se navegó a otra parte
    }
    openPatientById(id, nombre);
  }
  seccion.value = seccionDeLaRuta();
  if (isMobile.value) view.value = 'chat';
}
watch(() => route.fullPath, aplicarRuta);

// Device/browser Back en móvil. Con paciente lo resuelve el router (la lista es otra
// entrada del historial); el chat general no tiene URL, así que sigue con el centinela.
bindBackState(() => isMobile.value && view.value === 'chat' && !selectedId.value, () => { view.value = 'list'; });

onMounted(() => { mq.addEventListener('change', onMq); aplicarRuta(); });
onUnmounted(() => { mq.removeEventListener('change', onMq); });
</script>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.shell-list { min-height: 0; }
.shell-detail { min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.shell-chat { flex: 1; min-height: 0; }
.mchat-bar { display: none; }

@media (max-width: 768px) {
  .shell { grid-template-columns: 1fr; gap: 0; }
  .shell--list .shell-detail { display: none; }
  .shell--chat .shell-list { display: none; }
  .mchat-bar {
    display: flex; align-items: center; gap: 10px;
    flex-shrink: 0; padding: 6px 10px;
    background: var(--accent-band, #f1f5f9); border-bottom: 1px solid var(--border);
  }
  .mback {
    width: 34px; height: 34px; border-radius: 50%;
    border: 1.5px solid var(--border); background: #fff; color: var(--accent);
    font-size: 1.1rem; font-weight: 700; cursor: pointer; flex-shrink: 0;
  }
  .mtitle { font-weight: 700; font-size: 0.95rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}
</style>
