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
          @click="seccion = s.id"
        >{{ s.label }}</button>
      </nav>

      <!-- El chat queda montado: cambiar de sección no debe perder lo escrito. -->
      <IntakeChat
        v-show="seccion === 'chat'"
        ref="chatRef" :user="user" class="shell-chat"
        @closed="onChatClosed" @back="view = 'list'" @head="patientActive = $event"
      />
      <FichaCompleta
        v-if="selectedId && seccion === 'ficha'"
        :patient-id="selectedId" :episode-id="episodioDeLaFicha"
        :visitas="visitas" :cargando-visitas="cargandoVisitas"
        class="shell-chat"
      />
      <RejillaImagenes
        v-if="selectedId && seccion === 'imagenes'"
        :patient-id="selectedId" :mostrar-paciente="false"
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
import { listarCasosDePaciente } from '../api.js';
import { bindBackState } from '../useBackStack.js';
import { useRoute, useRouter } from 'vue-router';

defineProps({ user: Object });
const emit = defineEmits(['head']);

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
/** La ficha abre en la consulta más reciente; dentro se navega entre visitas. */
const episodioDeLaFicha = computed(() => visitas.value[0]?.id || null);

/** Las visitas del paciente, para la sección Ficha. Un fallo no se muestra como "sin fichas". */
async function cargarVisitas(patientId) {
  if (!patientId || visitasDe === patientId) return;
  cargandoVisitas.value = true;
  try {
    visitas.value = (await listarCasosDePaciente(patientId)).data || [];
    visitasDe = patientId;
  } catch {
    visitas.value = [];
    visitasDe = null;
  } finally {
    cargandoVisitas.value = false;
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

function onSelect(p) {
  seccion.value = 'chat';
  selectedId.value = p.id;
  selectedName.value = fullName(p);
  generalActive.value = false;
  chatRef.value?.openPatient(p.id, fullName(p));
  if (isMobile.value) view.value = 'chat';
}

function onGeneral() {
  selectedId.value = null;
  selectedName.value = '';
  generalActive.value = true;
  chatRef.value?.newGeneral();
  if (isMobile.value) view.value = 'chat';
}

// IntakeChat avisa que se cerró (p.ej. tras derivar) → deseleccionar el paciente
// y, en móvil, volver a la lista para elegir otro.
function onChatClosed() {
  selectedId.value = null;
  selectedName.value = '';
  generalActive.value = false;
  if (isMobile.value) view.value = 'list';
}

// Abrir un paciente por id (p.ej. desde una notificación del topbar).
function openPatientById(id, name) {
  seccion.value = 'chat';
  selectedId.value = id;
  selectedName.value = name || '';
  generalActive.value = false;
  chatRef.value?.openPatient(id, name || 'Paciente');
  if (isMobile.value) view.value = 'chat';
}
defineExpose({ openPatientById });

// Device/browser Back: while in the mobile chat view, go back to the list
// instead of leaving the app.
bindBackState(() => isMobile.value && view.value === 'chat', () => { view.value = 'list'; });

// `/chat?paciente=<id>` abre ese paciente: es como llegan las notificaciones desde
// que la vista la manda la ruta. La query se limpia después para que un atrás o un
// refresco no vuelvan a abrirlo solos.
const route = useRoute();
const router = useRouter();
function abrirDesdeLaRuta() {
  const id = route.query.paciente;
  if (!id) return;
  openPatientById(String(id), route.query.nombre ? String(route.query.nombre) : '');
  router.replace({ path: '/chat' });
}
watch(() => route.query.paciente, abrirDesdeLaRuta);

onMounted(() => { mq.addEventListener('change', onMq); abrirDesdeLaRuta(); });
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
