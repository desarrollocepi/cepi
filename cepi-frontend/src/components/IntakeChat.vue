<template>
  <div class="ichat">
    <div v-if="patientName" class="ihead" ref="iheadEl">
      <button type="button" class="ihead-back" @click="$emit('back')" title="Volver a la lista" aria-label="Volver">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      </button>
      <span class="ihead-name">👤 {{ patientName }}</span>
      <button type="button" class="ihead-burger" @click="showMenu = !showMenu" aria-label="Opciones" :aria-expanded="showMenu">☰</button>
      <div class="ihead-actions" :class="{ open: showMenu }">
        <div class="ihead-sections">
          <button type="button" :disabled="busy || !bookmarks.length" @click="showSections = !showSections" title="Secciones de la ficha">▤ Secciones ▾</button>
          <button type="button" class="autoform-toggle" :class="{ on: autoForm }" @click="toggleAutoForm" :title="autoForm ? 'Auto-form ON: el bot pide el siguiente campo faltante' : 'Auto-form OFF: solo se muestra el form que abras en Secciones'">{{ autoForm ? '🔁 Auto ✓' : '🔁 Auto ✕' }}</button>
          <div v-if="showSections && bookmarks.length" class="sections-panel" @click.self="showSections = false">
            <template v-for="(grp, gi) in bookmarkGroups" :key="'sg' + gi">
              <div v-if="grp.category" class="sections-cat">{{ grp.category }}</div>
              <button
                v-for="bm in grp.items" :key="bm.id" type="button" class="sections-item"
                :class="{ done: bm.done }" :disabled="busy" @click="openBookmark(bm)"
              ><span class="sec-check">{{ bm.done ? '✓' : '○' }}</span> {{ bm.label }}</button>
            </template>
          </div>
        </div>
        <button type="button" :disabled="busy || !currentPatientId" @click="openFicha" title="Ver la ficha clínica completa">👁️ Ficha</button>
        <button type="button" :disabled="busy" @click="openDerivar" title="Derivar el episodio a un círculo o a una persona">↪️ Derivar</button>
        <button type="button" :disabled="busy" @click="nuevaConsulta" title="Abrir una consulta nueva (el episodio anterior queda en el historial)">＋ Nueva consulta</button>
        <button type="button" @click="showDoctoPro = true" title="Consultar pacientes en DoctoPro">🔎 DoctoPro</button>
      </div>
    </div>

    <div v-if="patientName && episodeOrder.length" class="iepisodes">
      <button type="button" class="enav" :disabled="busy || episodeIndex <= 0" @click="prevEpisode" title="Consulta anterior">‹</button>
      <span class="ep-label">{{ episodeLabel }}</span>
      <button type="button" class="enav" :disabled="busy || episodeIndex >= episodeOrder.length - 1" @click="nextEpisode" title="Consulta siguiente">›</button>
      <button
        type="button" class="enav enav-now" :disabled="busy || isActiveEpisode"
        :title="isActiveEpisode ? 'Ya estás en la consulta actual' : 'Volver a la consulta actual'"
        @click="backToActiveEpisode"
      >↻ actual</button>
    </div>
    <div v-if="patientName && !isActiveEpisode" class="ireadonly">👁️ Consulta anterior (solo lectura)</div>

    <div class="ifeed" ref="feedEl">
      <div v-if="!visibleMessages.length && !busy" class="iwelcome">
        <p>Escribe o <b>pega un texto</b> con los datos del paciente y la IA los carga en la ficha.
           También puedes conversar normalmente; antes de guardar se pide confirmación.</p>
      </div>

      <div v-for="(m, i) in visibleMessages" :key="i" :class="['iturn', m.self ? 'user' : (m.is_bot ? 'assistant' : 'other')]">
        <span v-if="senderLabel(i)" class="iturn-sender">{{ senderLabel(i) }}</span>
        <MessageContent :content="m.content" />
      </div>
      <div v-if="busy" class="iturn assistant"><span class="thinking">escribiendo…</span></div>

      <div v-if="botForm && !busy && isActiveEpisode" class="iform">
        <button type="button" class="iform-close" @click="closeForm" title="Cerrar sección">✕</button>
        <BotForm :key="botForm.id" :form="botForm" :busy="busy" @send="send" @submit="onFormSubmit" />
      </div>

      <div v-if="quickReplies.length && !busy" class="iquick">
        <button v-for="(q, i) in quickReplies" :key="i" type="button" class="iquick-btn" @click="onQuickReply(q)">{{ q.label }}</button>
      </div>

      <div v-if="pending" class="ipending">
        <p class="ipending-summary">{{ pending.summary }}</p>
        <div class="ipending-actions">
          <button class="ok" :disabled="busy" @click="send('sí')">✓ Confirmar</button>
          <button class="no" :disabled="busy" @click="send('no')">✗ Cancelar</button>
        </div>
      </div>

      <p v-if="error" class="ierror">{{ error }}</p>
    </div>

    <p v-if="pendingAttachment" class="iattached">
      📎 {{ pendingAttachment.original_name || pendingAttachment.filename }}
      <button type="button" @click="pendingAttachment = null">quitar</button>
    </p>

    <!-- Composer en dos filas: el textarea ocupa todo el ancho y las acciones van
         debajo. En fila única los 3 botones le comían el ancho al texto. -->
    <form v-if="isActiveEpisode" class="icomposer" @submit.prevent="onSubmit">
      <textarea
        ref="taEl"
        v-model="draft"
        rows="1"
        :placeholder="dictating ? 'Escuchando… habla y toca el micrófono para parar' : 'Escribe, dicta o pega un texto largo…'"
        @keydown="onKey"
      ></textarea>
      <div class="icomposer-actions">
        <label class="iupload" :class="{ disabled: busy || uploading }" title="Adjuntar imagen">
          📎<input type="file" accept="image/*" :disabled="busy || uploading" @change="onFile" />
        </label>
        <button
          v-if="canDictate"
          type="button"
          class="imic"
          :class="{ on: dictating }"
          :disabled="busy"
          :title="dictating ? 'Detener dictado' : 'Dictar'"
          @click="toggleDictation"
        >{{ dictating ? '⏹ Parar' : '🎤 Dictar' }}</button>
        <button
          v-if="canDictate"
          type="button"
          class="iauto"
          :class="{ on: autoSend }"
          :aria-pressed="autoSend"
          :title="autoSend ? 'Envío automático activo: al terminar de hablar, el mensaje se envía solo' : 'Envío automático apagado: el dictado queda en el cuadro para revisarlo'"
          @click="toggleAutoSend"
        >⚡</button>
        <button type="submit" :disabled="busy || (!draft.trim() && !pendingAttachment)">
          {{ uploading ? '…' : 'Enviar' }}
        </button>
      </div>
    </form>
    <div v-else class="icomposer-ro">
      <span>Consulta anterior — solo lectura.</span>
      <button type="button" @click="backToActiveEpisode">Volver a la consulta actual</button>
    </div>

    <div v-if="showDerivar" class="derivar-modal" @click.self="showDerivar = false">
      <div class="derivar-panel">
        <div class="derivar-head">
          <strong>Derivar episodio</strong>
          <button type="button" @click="showDerivar = false">Cerrar</button>
        </div>
        <p class="derivar-hint">Escribe el motivo (opcional) y <b>elige un destino</b> para derivar — se ejecuta al instante.</p>
        <input v-model="derivarMotivo" class="derivar-motivo" type="text" placeholder="Motivo de la derivación (opcional)" />
        <button type="button" class="derivar-resp" :disabled="busy" @click="pickResponsable" title="Derivar al médico responsable del caso (o a quien lo creó)">⭐ Al responsable del caso</button>

        <p v-if="derivarError" class="derivar-error">{{ derivarError }}</p>
        <p v-if="derivarLoading" class="derivar-muted">Cargando destinos…</p>
        <ul v-else class="derivar-list">
          <li v-if="!derivarGroups.length" class="derivar-muted">No hay círculos disponibles.</li>
          <li v-for="g in derivarGroups" :key="g.id" class="derivar-group">
            <div class="dg-row">
              <button type="button" class="dg-pick" @click="pickCircle(g)" :title="g.kind === 'all' ? 'Derivar a toda la red' : 'Derivar al círculo ' + g.name">
                <span class="dg-name">{{ g.kind === 'all' ? '🌐' : '⭕' }} {{ g.name }}</span>
                <span class="dg-kind">{{ g.kind === 'all' ? 'toda la red' : g.kind }}</span>
              </button>
              <button v-if="g.kind !== 'all'" type="button" class="dg-expand" @click="toggleMembers(g)" title="Ver personas">
                {{ expandedGroup === g.slug ? '▾' : '▸' }} 👤{{ g.member_count }}
              </button>
              <span v-else class="dg-allcount">👤{{ g.member_count }}</span>
            </div>
            <ul v-if="g.kind !== 'all' && expandedGroup === g.slug" class="derivar-members">
              <li v-if="!(groupMembers[g.slug] || []).length" class="derivar-muted">(sin miembros)</li>
              <li v-for="m in (groupMembers[g.slug] || [])" :key="m.user_id">
                <button type="button" class="dm-pick" @click="pickPerson(m)" :title="'Derivar a ' + (m.name || m.email)">
                  👤 {{ m.name || m.email }}
                  <span v-if="m.role_in_group" class="dm-role">{{ m.role_in_group }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="showFicha" class="ficha-modal" @click.self="closeFicha">
      <div class="ficha-panel">
        <div class="ficha-head">
          <strong>Ficha clínica — {{ patientName || 'Paciente' }}</strong>
          <div class="ficha-head-actions">
            <button type="button" class="fh-save" @click="onSaveFicha">Guardar</button>
            <button type="button" @click="printFicha">Imprimir</button>
            <button type="button" @click="closeFicha">Cerrar</button>
          </div>
        </div>
        <div v-if="fichaEpisodes.length > 1" class="ficha-pager">
          <button type="button" :disabled="fichaIndex >= fichaEpisodes.length - 1" @click="fichaStep(1)">‹ Anterior</button>
          <span class="fp-label">{{ fichaPagerLabel }}</span>
          <button type="button" :disabled="fichaIndex <= 0" @click="fichaStep(-1)">Siguiente ›</button>
        </div>
        <iframe :key="fichaIndex" ref="fichaFrame" class="ficha-frame" src="/ficha.html" @load="onFichaLoad"></iframe>
      </div>
    </div>

    <DoctoProSearch v-if="showDoctoPro" @close="showDoctoPro = false" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { chat, saveSessionId, uploadAttachment, listGroups, listGroupMembers, listBotSessions, getPatientThread } from '../api.js';
import MessageContent from './MessageContent.vue';
import BotForm from './BotForm.vue';
import DoctoProSearch from './DoctoProSearch.vue';
import { createDictation, dictationSupported } from '../native/speech.js';

defineProps({ user: Object });
const emit = defineEmits(['closed', 'back', 'head']);

const draft = ref('');
const busy = ref(false);
const uploading = ref(false);
const error = ref('');
const sessionId = ref(null);             // the caller's OWN writable session for this patient
const pending = ref(null);
const quickReplies = ref([]);            // botones de respuesta rápida que devuelve el bot
const pendingAttachment = ref(null);
const patientName = ref('');
// Avisar arriba cuando el header del chat (con su burger) está activo, para que
// el topbar oculte SU burger y solo se vea uno a la vez.
watch(patientName, (v) => emit('head', !!v), { immediate: true });
const feedEl = ref(null);
const taEl = ref(null);

// ── Composer: el textarea crece con el texto en vez de scrollear ────────────
// `rows=1` fija la altura y el navegador mete scroll interno; acá la altura se
// recalcula contra scrollHeight en cada cambio. El tope lo pone max-height del
// CSS: pasado ese punto sí scrollea, si no el composer se comería el chat.
function autosize() {
  const ta = taEl.value;
  if (!ta) return;
  ta.style.height = 'auto';                 // sin esto nunca puede encoger
  ta.style.height = ta.scrollHeight + 'px';
}
watch(draft, () => nextTick(autosize));

// ── Dictado (STT) ───────────────────────────────────────────────────────────
// El texto dictado entra al mismo textarea que el tecleo: de ahí sigue por el
// pipeline normal (bot → extracción → form de la ficha). El médico ve lo que se
// transcribió y lo corrige antes de enviar.
const canDictate = dictationSupported;
const dictating = ref(false);
let session = null;
let dictBase = '';        // lo que había escrito antes de abrir el micrófono

// Envío automático: al cerrar el dictado, el texto sale solo. Se apoya en el
// modo NO continuo, donde el reconocedor cierra al detectar el fin de la frase
// — así hablás y el mensaje se manda sin tocar nada. Preferencia por dispositivo.
const AUTOSEND_KEY = 'cepi.stt.autosend';
const autoSend = ref(localStorage.getItem(AUTOSEND_KEY) === '1');
function toggleAutoSend() {
  autoSend.value = !autoSend.value;
  localStorage.setItem(AUTOSEND_KEY, autoSend.value ? '1' : '0');
}

function endDictation() {
  dictating.value = false;
  if (session) { session.dispose(); session = null; }
}

// Manos libres: si el dictado se envió solo, volver a escuchar cuando el bot
// termina de contestar. Se re-arma únicamente tras un envío por voz — escribir a
// mano no enciende el micrófono. Y si el dictado sale vacío no hay envío, así que
// tampoco hay respuesta ni re-armado: el ciclo se corta solo.
let reArm = false;
let manualStop = false;   // el usuario tocó ⏹: no enviar solo ni reencadenar
watch(busy, (isBusy, wasBusy) => {
  if (!(wasBusy && !isBusy)) return;      // solo en el flanco "terminó de responder"
  if (!reArm) return;
  reArm = false;
  if (!autoSend.value || dictating.value || error.value || !isActiveEpisode.value) return;
  toggleDictation();
});

async function toggleDictation() {
  if (dictating.value) {
    // ⏹ es la salida de emergencia del modo manos libres: corta la escucha, deja
    // el texto para revisar y NO reencadena. Sin esto, con ⚡ encendido el ciclo
    // dictar→enviar→escuchar no se podría interrumpir desde el propio botón.
    manualStop = true;
    await session?.stop();
    return;
  }

  error.value = '';
  manualStop = false;
  dictBase = draft.value.trim();
  dictating.value = true;
  const withAutoSend = autoSend.value;   // fijado al arrancar: que el toggle no cambie a mitad

  session = createDictation({
    // onPartial trae SIEMPRE el acumulado de la sesión, no un delta: por eso se
    // reemplaza la cola en vez de concatenar (si no, el texto se duplica).
    onPartial: (text) => { draft.value = (dictBase ? dictBase + ' ' : '') + text; },
    onFinal:   (text) => {
      draft.value = ((dictBase ? dictBase + ' ' : '') + text).trim();
      if (withAutoSend && draft.value && !manualStop) { reArm = true; nextTick(onSubmit); }
    },
    onEnd:     endDictation,
    onError:   (e) => { error.value = e.message; endDictation(); },
  }, { continuous: !withAutoSend });

  try {
    await session.start();
  } catch (e) {
    error.value = e?.message || 'No se pudo iniciar el dictado.';
    endDictation();
  }
}

// ── Ficha: secciones (bookmarks) + form inline + visor ──────────────────────
const botForm = ref(null);               // form de la sección abierta (BotForm) o null
const bookmarks = ref([]);               // [{id,label,category,done}] de la ficha
const activeEpisodeId = ref(null);
const showSections = ref(false);         // dropdown de secciones
// Auto-form ON: el bot muestra el form del siguiente campo faltante tras abrir y
// tras cada guardado (sigue preguntando). OFF: solo muestra el form pedido en
// "Secciones", sin auto-avanzar al siguiente.
// Auto-form es intrínseco de ESTE chat (paciente): se guarda por paciente, no
// se propaga a otros. OFF por defecto.
const autoForm = ref(false);
function autoformKey() { return 'cepi.autoform.' + (currentPatientId.value || 'general'); }
function loadAutoForm() { autoForm.value = localStorage.getItem(autoformKey()) === '1'; }
function toggleAutoForm() {
  autoForm.value = !autoForm.value;
  localStorage.setItem(autoformKey(), autoForm.value ? '1' : '0');
  showMenu.value = false;                                   // cerrar el menú al accionar
  if (autoForm.value) {
    // Auto ON → disparar enseguida la siguiente sección pendiente de la ficha.
    const next = bookmarks.value.find(b => !b.done);
    if (next && !busy.value && isActiveEpisode.value) openBookmark(next);
  }
}
const showMenu = ref(false);             // burger de acciones (mobile)
const iheadEl = ref(null);               // header del chat (para cerrar el menú por blur)
const showFicha = ref(false);            // modal del visor de ficha
const showDoctoPro = ref(false);         // modal de consulta DoctoPro
const fichaEpisodes = ref([]);
const fichaIndex = ref(0);
const fichaFrame = ref(null);
const fichaInitial = ref('');            // snapshot del visor al cargar (para detectar cambios sin guardar)

// Secciones agrupadas por categoría para el dropdown.
const bookmarkGroups = computed(() => {
  const out = []; let cur = null;
  for (const bm of bookmarks.value) {
    if (!cur || cur.category !== bm.category) { cur = { category: bm.category, items: [] }; out.push(cur); }
    cur.items.push(bm);
  }
  return out;
});
const fichaPagerLabel = computed(() => {
  const total = fichaEpisodes.value.length;
  if (!total) return '';
  const ep = fichaEpisodes.value[fichaIndex.value]?.data || {};
  return `${ep.fecha || 's/f'} · episodio ${total - fichaIndex.value} de ${total}`;
});

// ── One group thread per patient (WhatsApp-style) ───────────────────────────
// `messages` is the merged, chronological, attributed feed of every clinician's
// messages + the bot for the active patient (backend /api/patient-thread). We
// write to our own session (sessionId, created lazily); after each send we
// reload the thread so the new message appears attributed.
const messages = ref([]);
const currentPatientId = ref(null);

// ── Navegación por episodios (consultas) ────────────────────────────────────
// El hilo se muestra por episodio (un episodio por "página"); las flechas ‹ ›
// navegan los episodios del paciente. Cada turno trae su episode_id (sellado por
// el bot), así que agrupamos con precisión aun si una sesión abarcó varios.
const currentEpisodeId = ref(undefined);
const episodeOrder = computed(() => {       // episode_ids distintos, cronológico (viejo→nuevo)
  const seen = new Set(); const out = [];
  for (const m of messages.value) {
    const e = m.episode_id || null;
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  // El episodio activo (consulta nueva) puede no tener mensajes aún → igual debe
  // ser navegable como la página actual (vacía).
  const ae = activeEpisodeId.value;
  if (ae && !seen.has(ae)) out.push(ae);
  return out;
});
const episodeIndex = computed(() => {
  const i = episodeOrder.value.indexOf(currentEpisodeId.value);
  return i >= 0 ? i : episodeOrder.value.length - 1;   // por defecto, el más nuevo
});
// El ack de activación del bot ("Paciente activo: … Continuamos la consulta … 📋
// Faltan N secciones…") es puramente informativo y el bot lo re-emite en CADA
// activación/reanudación, por lo que se acumula en el hilo. Mostrarlo una sola
// vez: dejamos únicamente la última aparición y filtramos las anteriores.
// (Solo este mensaje — el resto de los turnos del bot se muestran tal cual.)
function isActivationAck(m) {
  return !!m.is_bot && /^Paciente activo:/.test((m.content || '').trimStart());
}
const visibleMessages = computed(() => {
  const ord = episodeOrder.value;
  let list = ord.length <= 1
    ? messages.value
    : messages.value.filter(m => (m.episode_id || null) === ord[episodeIndex.value]);
  let lastAck = -1;
  for (let k = 0; k < list.length; k++) if (isActivationAck(list[k])) lastAck = k;
  if (lastAck !== -1) list = list.filter((m, k) => k === lastAck || !isActivationAck(m));
  return list;
});
const isActiveEpisode = computed(() => {
  const ord = episodeOrder.value;
  if (ord.length <= 1) return true;
  const active = activeEpisodeId.value || ord[ord.length - 1];
  return ord[episodeIndex.value] === active;
});
const episodeLabel = computed(() => {
  const ord = episodeOrder.value;
  // Con una sola consulta la etiqueta iba vacía y la barra quedaba con dos flechas
  // muertas y un hueco. Decir que es la única explica por qué no hay a dónde ir.
  if (ord.length === 1) return 'Única consulta';
  if (!ord.length) return '';
  const cur = ord[episodeIndex.value];
  const first = messages.value.find(m => (m.episode_id || null) === cur);
  const when = first?.ts ? new Date(first.ts).toLocaleDateString('es', { day: '2-digit', month: 'short' }) : '';
  return `Consulta ${episodeIndex.value + 1}/${ord.length}${when ? ' · ' + when : ''}`;
});
function prevEpisode() { const i = episodeIndex.value; if (i > 0) { currentEpisodeId.value = episodeOrder.value[i - 1]; scrollEnd(); } }
function nextEpisode() { const i = episodeIndex.value; if (i < episodeOrder.value.length - 1) { currentEpisodeId.value = episodeOrder.value[i + 1]; scrollEnd(); } }
function backToActiveEpisode() { currentEpisodeId.value = activeEpisodeId.value; scrollEnd(); }

// Sender label above a left-side message, shown once per run of consecutive
// messages from the same author (like a WhatsApp group). '' = no label.
function senderLabel(i) {
  const list = visibleMessages.value;
  const m = list[i];
  if (!m || m.self) return '';
  const prev = list[i - 1];
  if (prev && !prev.self && prev.author_id === m.author_id) return '';
  return m.is_bot ? '🤖 Asistente' : (m.author_name || 'Profesional');
}

// ── Derivar: picker of circles (user_groups) and their members ────────────────
const showDerivar    = ref(false);
const derivarGroups  = ref([]);
const derivarLoading = ref(false);
const derivarError   = ref('');
const derivarMotivo  = ref('');          // motivo opcional para la derivación
const expandedGroup  = ref('');          // slug currently expanded to show members
const groupMembers   = ref({});          // slug → members[] (cached)

function prefillCommand(text) {
  draft.value = text;
  nextTick(() => {
    const ta = taEl.value;
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  });
}

async function openDerivar() {
  showDerivar.value = true;
  showMenu.value = false;
  derivarError.value = '';
  expandedGroup.value = '';
  if (derivarGroups.value.length) return;   // cached from a previous open
  derivarLoading.value = true;
  try {
    const r = await listGroups();
    // Exclude the on-call 'turno' roster — that's "enviar caso", not derivar.
    // Put the virtual "todos" (kind 'all') first for prominence.
    derivarGroups.value = (r?.data || [])
      .filter(g => g.kind !== 'roster')
      .sort((a, b) => (b.kind === 'all' ? 1 : 0) - (a.kind === 'all' ? 1 : 0));
  } catch (e) {
    derivarError.value = e?.message || 'No se pudieron cargar los destinos.';
  } finally {
    derivarLoading.value = false;
  }
}

async function toggleMembers(g) {
  if (expandedGroup.value === g.slug) { expandedGroup.value = ''; return; }
  expandedGroup.value = g.slug;
  if (groupMembers.value[g.slug]) return;   // cached
  try {
    const r = await listGroupMembers(g.slug);
    groupMembers.value = { ...groupMembers.value, [g.slug]: r?.data || [] };
  } catch {
    groupMembers.value = { ...groupMembers.value, [g.slug]: [] };
  }
}

// Elegir un destino EJECUTA la derivación (antes solo la pre-escribía en el
// input). Círculo → "derivar a <slug> [motivo]". Persona → "escalar a <uuid> [motivo]".
async function pickCircle(g) {
  const motivo = derivarMotivo.value.trim();
  showDerivar.value = false;
  derivarMotivo.value = '';
  await send(`derivar a ${g.slug}${motivo ? ' ' + motivo : ''}`);
  if (!error.value) closeChat();           // derivado → cerrar el chat para elegir otro
}
async function pickPerson(m) {
  const motivo = derivarMotivo.value.trim();
  showDerivar.value = false;
  derivarMotivo.value = '';
  await send(`escalar a ${m.user_id}${motivo ? ' ' + motivo : ''}`);
  if (!error.value) closeChat();
}
// Derivar al responsable del caso: el responsable_actual_id del episodio (quien
// lo reclamó/se le asignó por turno) o, si no hay, el médico que lo creó.
async function pickResponsable() {
  const epId = activeEpisodeId.value;
  if (!epId) { derivarError.value = 'No hay episodio activo.'; return; }
  derivarError.value = '';
  const ep = await fetchEntity(epId);
  const d = ep?.data || {};
  const uid = d.responsable_actual_id || d.medico_id || '';
  if (!uid) { derivarError.value = 'El episodio no tiene responsable ni creador definido.'; return; }
  const motivo = derivarMotivo.value.trim();
  showDerivar.value = false;
  derivarMotivo.value = '';
  await send(`escalar a ${uid}${motivo ? ' ' + motivo : ''}`);
  if (!error.value) closeChat();
}

// Cierra el chat localmente (sin tocar el servidor) y avisa a ChatShell para
// deseleccionar el paciente — tras derivar, el médico pasa al siguiente.
function closeChat() {
  reset();
  patientName.value = '';
  emit('closed');
}

async function scrollEnd() {
  await nextTick();
  const el = feedEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function send(message, extra = {}) {
  const fs = extra.formSubmission || null;
  if ((!message || !message.trim()) && !fs) return;
  if (busy.value) return;
  const uuid = currentPatientId.value;
  busy.value = true;
  error.value = '';
  // Optimistic echo of my own text (not for form submissions); reloadThread() reconciles it.
  if (message && message.trim()) {
    messages.value = [...messages.value, { role: 'user', content: message, self: true, is_bot: false }];
    await scrollEnd();
  }
  try {
    // Lazily create + bind my session on the first message (avoids spawning a
    // session just by browsing a patient).
    if (!sessionId.value && uuid) {
      const a = await chat('activar paciente ' + uuid, null);
      if (currentPatientId.value !== uuid) return;
      if (a?.session_id) { sessionId.value = a.session_id; saveSessionId(a.session_id); }
    }
    const r = await chat(message, sessionId.value, extra);
    if (currentPatientId.value !== uuid) return;            // patient switched → drop stale
    if (r?.session_id) { sessionId.value = r.session_id; saveSessionId(r.session_id); }
    if (typeof r?.pending_action !== 'undefined') pending.value = r.pending_action;
    quickReplies.value = Array.isArray(r?.quick_replies) ? r.quick_replies : [];
    captureFicha(r, !!extra._explicit);                    // form / bookmarks / episodio
    await reloadThread();
  } catch (e) {
    // The send failed: drop the optimistic echo by re-syncing with the server,
    // so the user never sees a phantom "sent" message alongside the error.
    if (currentPatientId.value === uuid) {
      error.value = e.message || String(e);
      await reloadThread();
    }
  } finally {
    if (currentPatientId.value === uuid) busy.value = false;
    await scrollEnd();
  }
}

// ── Ficha: secciones (dropdown), form inline y visor ────────────────────────
function captureFicha(r, explicit = false) {
  if (!r) return;
  // Con auto-form OFF, solo mostramos el form si fue pedido explícitamente
  // (Secciones); los forms "automáticos" (al abrir / tras guardar) se suprimen.
  if ('form' in r) botForm.value = (explicit || autoForm.value) ? (r.form || null) : null;
  if (Array.isArray(r.bookmarks)) bookmarks.value = r.bookmarks;
  if ('active_episode_id' in r) {
    activeEpisodeId.value = r.active_episode_id || null;
    currentEpisodeId.value = activeEpisodeId.value;   // abrir/enviar/nueva consulta → ver el episodio activo
  }
}
function onFormSubmit(payload) { send('', { formSubmission: payload }); }
function onQuickReply(q) { if (busy.value) return; quickReplies.value = []; send(q.send); }
function openBookmark(bm) {
  if (busy.value) return;
  showSections.value = false;
  showMenu.value = false;
  // _explicit: el form pedido en Secciones siempre se muestra (aunque auto-form esté OFF).
  send('', { formSubmission: { form_id: 'ficha_goto', data: { group: bm.id } }, _explicit: true });
}
function closeForm() { botForm.value = null; }

async function fetchEntity(id) {
  try {
    const res = await fetch(`/api/entities/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('cepi.jwt') || ''}` } });
    if (!res.ok) return null;
    return (await res.json())?.data || null;
  } catch { return null; }
}
async function fetchEpisodes(patientId) {
  try {
    const params = new URLSearchParams({ type: 'business', entity_id: '12000000-0000-0000-0000-000000000000', 'filter[patient_id]': patientId, limit: '100' });
    const res = await fetch(`/api/entities?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem('cepi.jwt') || ''}` } });
    if (!res.ok) return [];
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    rows.sort((a, b) => String(b?.data?.fecha || '').localeCompare(String(a?.data?.fecha || '')));
    return rows;
  } catch { return []; }
}
async function openFicha() {
  if (!currentPatientId.value) return;
  showMenu.value = false;
  fichaEpisodes.value = []; fichaIndex.value = 0;
  const eps = await fetchEpisodes(currentPatientId.value);
  fichaEpisodes.value = eps;
  const i = eps.findIndex(e => e.id === activeEpisodeId.value);
  fichaIndex.value = i >= 0 ? i : 0;
  showFicha.value = true;
}
function fichaStep(dir) {
  const n = fichaIndex.value + dir;
  if (n >= 0 && n < fichaEpisodes.value.length) fichaIndex.value = n;
}
async function onFichaLoad() {
  const frame = fichaFrame.value;
  if (!frame?.contentWindow?.fillFicha) return;
  let pdata = {};
  if (currentPatientId.value) { const p = await fetchEntity(currentPatientId.value); pdata = p?.data || {}; }
  const edata = fichaEpisodes.value[fichaIndex.value]?.data || {};
  const data = { ...pdata, ...edata };
  data.nombre = [pdata.nombre, pdata.apellidos].filter(Boolean).join(' ') || data.nombre;
  if (!data.edad && pdata.fecha_nac) {
    const d = new Date(pdata.fecha_nac);
    if (!isNaN(d.getTime())) {
      const now = new Date(); let a = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
      if (a >= 0 && a < 150) data.edad = a;
    }
  }
  try { frame.contentWindow.fillFicha(data); } catch { /* ficha API no lista */ }
  try {
    const cur = edata; const prev = fichaEpisodes.value[fichaIndex.value + 1]?.data; const changed = {};
    if (prev) {
      const SKIP = new Set(['id', 'fecha', 'medico_id', 'patient_id', 'estado', 'tipo', 'created_at', 'updated_at', 'ficha_num', 'examinador_nombre', 'gravedad_total', 'location']);
      const norm = v => (v === null || v === undefined || v === false || v === '') ? '' : String(v);
      for (const k of new Set([...Object.keys(cur), ...Object.keys(prev)])) {
        if (SKIP.has(k) || k.includes(':')) continue;
        if (norm(cur[k]) !== norm(prev[k])) changed[k] = prev[k];
      }
    }
    frame.contentWindow.markChanges?.(changed);
  } catch { /* diff best-effort */ }
  // Snapshot del estado cargado, para detectar ediciones sin guardar al cerrar.
  try { fichaInitial.value = JSON.stringify(frame.contentWindow.readFicha?.() || {}); } catch { fichaInitial.value = ''; }
}

// Cerrar el visor avisando si hay cambios sin guardar (el visor es editable).
function closeFicha() {
  let cur = '';
  try { cur = JSON.stringify(fichaFrame.value?.contentWindow?.readFicha?.() || {}); } catch { cur = ''; }
  if (cur && fichaInitial.value && cur !== fichaInitial.value
      && !confirm('Hay cambios sin guardar en la ficha. ¿Cerrar y descartarlos?')) return;
  showFicha.value = false;
}
function printFicha() { fichaFrame.value?.contentWindow?.print(); }
// Guardar lo editado en el visor: lee el iframe y persiste vía bot (ficha_save
// actualiza paciente + episodio). Sin esto, editar y cerrar descartaba sin aviso.
function onSaveFicha() {
  const frame = fichaFrame.value;
  if (!frame?.contentWindow?.readFicha) return;
  let data;
  try { data = frame.contentWindow.readFicha(); } catch { return; }
  const ep = fichaEpisodes.value[fichaIndex.value];
  showFicha.value = false;
  send('', { formSubmission: { form_id: 'ficha_save', episode_id: ep?.id || null, data } });
}

function onKey(ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); onSubmit(); }
}
function onSubmit() {
  if (dictating.value) session?.stop();     // enviar cierra el dictado en curso
  // Android compone mientras escribís (autocorrección, deslizamiento) y Vue
  // ignora los `input` con `composing=true`, así que `draft` puede ir atrasado
  // respecto de lo que se ve. El blur cierra la composición; leemos el DOM.
  const ta = taEl.value;
  if (ta) { ta.blur(); if (ta.value !== draft.value) draft.value = ta.value; }
  const t = draft.value.trim();
  let payload = t;
  if (pendingAttachment.value) {
    const a = pendingAttachment.value;
    payload = (t ? t + '\n' : '') + `[adjunto: ${a.original_name || a.filename} · ${a.id}]`;
  }
  draft.value = '';
  pendingAttachment.value = null;
  if (payload) send(payload);
}
async function onFile(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  uploading.value = true;
  error.value = '';
  try { pendingAttachment.value = await uploadAttachment(f); }
  catch (e) { error.value = 'Subida falló: ' + (e.message || e); }
  finally { uploading.value = false; }
}

function reset() {
  sessionId.value = null;
  localStorage.removeItem('cepi.session_id');
  messages.value = [];
  pending.value = null;
  quickReplies.value = [];
  pendingAttachment.value = null;
  error.value = '';
  currentPatientId.value = null;
  botForm.value = null;
  bookmarks.value = [];
  activeEpisodeId.value = null;
  currentEpisodeId.value = undefined;
  showSections.value = false;
}

// Botón "Nueva consulta": abre un episodio nuevo (cualquier médico). El anterior
// queda en el hilo del paciente. Reusa el comando server-side 'nuevo episodio'.
function nuevaConsulta() {
  if (busy.value) return;
  showSections.value = false;
  showMenu.value = false;
  send('nuevo episodio');
}

// Fetch + render the patient's merged group thread. Does not toggle busy (the
// caller owns the busy/loading state across the whole open/send sequence).
async function reloadThread() {
  const uuid = currentPatientId.value;
  if (!uuid) { messages.value = []; return; }
  try {
    const r = await getPatientThread(uuid);
    if (currentPatientId.value !== uuid) return;            // patient switched → drop
    messages.value = Array.isArray(r?.messages) ? r.messages : [];
    await scrollEnd();                                       // al abrir/recargar, ir al último mensaje
  } catch (e) {
    if (currentPatientId.value === uuid) error.value = 'No se pudo cargar el hilo: ' + (e.message || e);
  }
}

// Resume the caller's most-recent OPEN session for this patient (for writing).
// Returns its id, or null when none exists (one is then created lazily on the
// first message — so merely browsing a patient never spawns a session).
async function findMyOpenSession(uuid) {
  try {
    const r = await listBotSessions(uuid);
    const open = (r?.sessions || []).find(s => s.active_patient_id === uuid && s.estado === 'abierta');
    return open ? open.id : null;
  } catch { return null; }
}

// Driven by ChatShell: open a patient's group thread (or start a general chat).
// On open we (re)activate the patient — reusing the caller's open session if any,
// else creating one — so the bot greets and tells the user what's still pending
// in the ficha. Then we render the merged group thread.
async function openPatient(uuid, name) {
  if (!uuid) return;
  reset();
  patientName.value = name || '';
  currentPatientId.value = uuid;
  loadAutoForm();                          // estado auto-form propio de este paciente
  busy.value = true;
  try {
    const sid = await findMyOpenSession(uuid);
    if (currentPatientId.value !== uuid) return;            // switched mid-load → drop
    const r = await chat('activar paciente ' + uuid, sid); // server-side, no LLM
    if (currentPatientId.value !== uuid) return;
    if (r?.session_id) { sessionId.value = r.session_id; saveSessionId(r.session_id); }
    quickReplies.value = Array.isArray(r?.quick_replies) ? r.quick_replies : [];
    captureFicha(r);                                        // secciones (bookmarks) + episodio
    await reloadThread();
  } catch (e) {
    if (currentPatientId.value === uuid) error.value = e.message || String(e);
  } finally {
    if (currentPatientId.value === uuid) busy.value = false;
  }
}

function newGeneral() {
  reset();
  patientName.value = '';
  loadAutoForm();                          // chat general → su propio estado
}

// Cerrar el menú (burger) del chat al hacer click fuera del header.
function onDocClick(ev) {
  if (!showMenu.value && !showSections.value) return;
  if (iheadEl.value && !iheadEl.value.contains(ev.target)) {
    showMenu.value = false;
    showSections.value = false;
  }
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  // Dejar el micrófono abierto al salir del chat es un bug de batería y de
  // privacidad, además de bloquear el recognizer para la próxima sesión.
  if (session) { session.stop(); session.dispose(); session = null; }
});
defineExpose({ openPatient, newGeneral });
</script>

<style scoped>
.ichat {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: #fff; border: 1px solid var(--border); border-radius: 12px;
  overflow: hidden;
}
.ihead {
  position: relative;
  flex-shrink: 0; padding: 8px 12px; font-weight: 700; font-size: 0.92rem;
  color: #fff; background: var(--accent-band, var(--accent)); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
/* Burger de acciones — solo móvil. */
.ihead-burger {
  display: none; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.55); background: rgba(255,255,255,.15); color: #fff;
  border-radius: 8px; width: 32px; height: 30px; font-size: 1rem; line-height: 1; cursor: pointer;
}
.ihead-burger:hover { background: rgba(255,255,255,.3); }
@media (max-width: 768px) {
  .ihead-burger { display: inline-flex; align-items: center; justify-content: center; }
  /* Las acciones pasan a un menú desplegable (burger). `.ihead` para ganar
     especificidad sobre la regla base `.ihead-actions { display:flex }`. */
  .ihead .ihead-actions {
    display: none;
    position: absolute; top: calc(100% + 4px); right: 6px; z-index: 75;
    flex-direction: column; align-items: stretch; gap: 4px; flex-wrap: nowrap;
    background: #fff; border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 12px 30px rgba(0,0,0,.28); padding: 6px; min-width: 200px; max-width: 84vw;
  }
  .ihead .ihead-actions.open { display: flex; }
  .ihead-actions .ihead-sections { display: block; width: 100%; }
  /* Botones del menú: texto oscuro sobre blanco (no la banda del header). */
  .ihead-actions.open > button,
  .ihead-actions.open .ihead-sections > button {
    color: var(--text); background: #fff; border: 1px solid var(--border);
    border-radius: 8px; text-align: left; width: 100%; padding: 8px 10px; font-weight: 600;
  }
  .ihead-actions.open button:hover:not(:disabled) { background: var(--bg); }
  .ihead-actions.open .autoform-toggle.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  /* La lista de secciones se muestra inline dentro del menú (no panel flotante). */
  .ihead-actions.open .sections-panel {
    position: static; box-shadow: none; border: 0; border-top: 1px solid var(--border);
    border-radius: 0; width: auto; max-height: 40vh; margin-top: 4px; padding: 2px 0;
  }
}
.ihead-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Botón "volver" dentro del header del chat — solo en móvil (en desktop la lista
   siempre está visible al lado). */
.ihead-back {
  display: none; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.55); background: rgba(255,255,255,.15); color: #fff;
  border-radius: 50%; width: 30px; height: 30px; font-size: 1.05rem; line-height: 1; cursor: pointer;
}
.ihead-back:hover { background: rgba(255,255,255,.3); }
@media (max-width: 768px) { .ihead-back { display: inline-flex; align-items: center; justify-content: center; } }
.autoform-toggle.on { background: rgba(255,255,255,.4); border-color: #fff; }
.ihead-actions { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

/* Barra de navegación de episodios (consultas). */
.iepisodes {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 5px 10px; background: var(--bg); border-bottom: 1px solid var(--border);
}
.iepisodes .enav {
  border: 1px solid var(--border); background: #fff; color: var(--text);
  border-radius: 14px; padding: 2px 10px; font-size: 0.8rem; font-weight: 700; cursor: pointer; line-height: 1.4;
}
.iepisodes .enav:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.iepisodes .enav:disabled { opacity: .35; cursor: not-allowed; }
.iepisodes .enav-now { border-style: dashed; }
.ep-label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
.ireadonly {
  flex-shrink: 0; text-align: center; padding: 5px 10px; font-size: 0.8rem;
  background: #fef3c7; color: #92400e; border-bottom: 1px solid #fcd34d;
}
.icomposer-ro {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 12px; border-top: 1px solid var(--border); background: var(--bg);
  color: var(--text-muted); font-size: 0.86rem;
}
.icomposer-ro button {
  border: 1px solid var(--accent); background: #fff; color: var(--accent);
  border-radius: 18px; padding: 6px 12px; font-weight: 700; font-size: 0.8rem; cursor: pointer;
}
.icomposer-ro button:hover { background: var(--accent); color: #fff; }
.ihead-actions button {
  border: 1px solid rgba(255,255,255,.55); background: rgba(255,255,255,.15); color: #fff;
  border-radius: 14px; padding: 4px 10px; font-size: 0.78rem; font-weight: 600; cursor: pointer;
  white-space: nowrap;
}
.ihead-actions button:hover:not(:disabled) { background: rgba(255,255,255,.28); }
.ihead-actions button:disabled { opacity: .5; cursor: not-allowed; }

/* Dropdown de secciones de la ficha. */
.ihead-sections { position: relative; display: inline-flex; }
.sections-panel {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 70;
  width: min(280px, 80vw); max-height: 60vh; overflow-y: auto;
  background: #fff; color: var(--text); border: 1px solid var(--border);
  border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 4px 0;
}
.sections-panel .sections-cat { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); padding: 6px 12px 2px; }
/* qualified with .sections-panel to override .ihead-actions button (white text). */
.sections-panel .sections-item {
  width: 100%; text-align: left; border: 0; border-radius: 0; background: transparent;
  color: var(--text); white-space: normal;
  padding: 7px 12px; font-size: 0.84rem; font-weight: 500; cursor: pointer; display: flex; gap: 8px; align-items: center;
}
.sections-panel .sections-item:hover:not(:disabled) { background: var(--bg); }
.sections-panel .sections-item.done { color: var(--text-muted); }
.sections-panel .sections-item .sec-check { color: #16a34a; font-weight: 800; width: 12px; flex-shrink: 0; }
.sections-panel .sections-item:not(.done) .sec-check { color: var(--text-muted); }

/* Form inline de una sección de la ficha. */
.iform { position: relative; align-self: stretch; background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
.iform-close { position: absolute; top: 6px; right: 8px; z-index: 2; border: 0; background: transparent; color: var(--text-muted); font-size: 1rem; cursor: pointer; }

/* Visor de ficha (iframe /ficha.html). */
.ficha-modal { position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 16px; }
.ficha-panel { background: #fff; border-radius: 10px; overflow: hidden; width: min(840px, 96vw); height: min(96vh, 1200px); display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,.3); }
.ficha-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.9rem; color: var(--text); }
.ficha-head-actions { display: flex; gap: 6px; }
.ficha-head button.fh-save { background: var(--accent); color: #fff; border-color: var(--accent); }
.ficha-head button.fh-save:hover { background: var(--accent-hover, var(--accent)); color: #fff; }
.ficha-head button { border: 1.5px solid var(--border); background: #f8fafc; color: var(--text); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-weight: 600; font-size: 0.82rem; }
.ficha-head button:hover { border-color: var(--accent); color: var(--accent); }
.ficha-pager { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 6px 12px; flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border); }
.ficha-pager button { border: 1.5px solid var(--border); background: #fff; color: var(--text); border-radius: 6px; padding: 3px 12px; cursor: pointer; font-weight: 600; font-size: 0.8rem; }
.ficha-pager button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ficha-pager button:disabled { opacity: .4; cursor: not-allowed; }
.fp-label { font-size: 0.82rem; color: var(--text-muted); font-weight: 600; }
.ficha-frame { flex: 1; width: 100%; border: 0; background: #e8e8e8; }

/* Group thread: sender label + distinct bubble for other clinicians (WhatsApp-style). */
.iturn-sender { display: block; font-size: 0.72rem; font-weight: 700; margin-bottom: 3px; opacity: .92; }
.iturn.other {
  align-self: flex-start;
  background: #f3e8ff; color: var(--text); border: 1px solid #e9d5ff;
  border-bottom-left-radius: 4px;
}
.iturn.other .iturn-sender { color: #7c3aed; }
.iturn.assistant .iturn-sender { color: #475569; }

/* Derivar picker modal. */
.derivar-modal {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 16px;
}
.derivar-panel {
  background: #fff; color: var(--text); border-radius: 10px;
  width: min(460px, 96vw); max-height: min(86vh, 760px);
  display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,.3);
}
.derivar-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.95rem;
}
.derivar-head button {
  border: 1.5px solid var(--border); background: #f8fafc; color: var(--text);
  border-radius: 6px; padding: 4px 12px; cursor: pointer; font-weight: 600;
}
.derivar-head button:hover { border-color: var(--accent); color: var(--accent); }
.derivar-hint { margin: 10px 14px 4px; font-size: 0.82rem; color: var(--text-muted); }
.derivar-motivo {
  margin: 4px 14px 8px; width: calc(100% - 28px); box-sizing: border-box;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 7px;
  font-size: 0.88rem; background: var(--bg); color: var(--text); outline: none;
}
.derivar-motivo:focus { border-color: var(--accent); }
.derivar-resp {
  margin: 0 14px 8px; width: calc(100% - 28px); box-sizing: border-box;
  padding: 9px 10px; border: 1px solid var(--accent); border-radius: 8px;
  background: var(--accent-band, #eef6fb); color: var(--accent); font-weight: 700;
  font-size: 0.88rem; cursor: pointer; text-align: left;
}
.derivar-resp:hover:not(:disabled) { background: var(--accent); color: #fff; }
.derivar-resp:disabled { opacity: .5; cursor: not-allowed; }
.derivar-error { margin: 6px 14px; color: #c43d3d; font-size: 0.82rem; }
.derivar-muted { color: var(--text-muted); font-size: 0.84rem; padding: 4px 6px; list-style: none; }
.derivar-list { list-style: none; margin: 6px 0 10px; padding: 0 8px; overflow-y: auto; }
.derivar-group { border-bottom: 1px solid var(--border); }
.dg-row { display: flex; align-items: stretch; gap: 6px; padding: 4px 0; }
.dg-pick {
  flex: 1; text-align: left; border: 1px solid var(--border); background: #f8fafc; color: var(--text);
  border-radius: 7px; padding: 8px 10px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.dg-pick:hover { border-color: var(--accent); color: var(--accent); }
.dg-name { font-weight: 600; font-size: 0.9rem; }
.dg-kind { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
.dg-expand {
  border: 1px solid var(--border); background: #fff; color: var(--text);
  border-radius: 7px; padding: 0 10px; cursor: pointer; font-size: 0.8rem; white-space: nowrap;
}
.dg-expand:hover { border-color: var(--accent); color: var(--accent); }
.dg-allcount { display: flex; align-items: center; padding: 0 10px; font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; }
.derivar-members { list-style: none; margin: 0 0 6px; padding: 0 0 0 14px; }
.derivar-members li { padding: 2px 0; }
.dm-pick {
  width: 100%; text-align: left; border: 1px dashed var(--border); background: transparent; color: var(--text);
  border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 0.86rem;
  display: flex; align-items: center; gap: 8px;
}
.dm-pick:hover { border-color: var(--accent); color: var(--accent); border-style: solid; }
.dm-role { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; }
.ifeed { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.iwelcome { margin: auto; max-width: 460px; text-align: center; color: var(--text-muted); font-size: 0.92rem; line-height: 1.6; }
.iturn { max-width: 82%; padding: 0.6rem 0.9rem; border-radius: var(--radius, 12px); font-size: 0.93rem; line-height: 1.5; word-break: break-word; }
.iturn.user { align-self: flex-end; background: var(--user-bg, #2596be); color: var(--user-text, #fff); border-bottom-right-radius: 4px; }
.iturn.assistant, .iturn.tool { align-self: flex-start; background: var(--bot-bg, #f1f5f9); color: var(--text); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
.thinking { color: var(--text-muted); font-style: italic; }
.iquick { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.iquick-btn { border: 1.5px solid var(--accent); background: #fff; color: var(--accent); border-radius: 18px; padding: 8px 16px; font-weight: 700; font-size: 0.88rem; cursor: pointer; }
.iquick-btn:hover { background: var(--accent); color: #fff; }
.ipending { align-self: stretch; background: #fefce8; border: 2px solid #facc15; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.ipending-summary { margin: 0; color: #422006; font-size: 0.9rem; }
.ipending-actions { display: flex; gap: 8px; }
.ipending-actions button { flex: 1; padding: 8px; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; }
.ipending-actions .ok { background: #16a34a; color: #fff; }
.ipending-actions .no { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
.ierror { color: #dc2626; font-size: 13px; }
.iattached { flex-shrink: 0; margin: 0; padding: 6px 14px; font-size: 13px; color: #3730a3; background: #eef2ff; border-top: 1px solid #c7d2fe; }
.iattached button { background: none; border: 0; color: #6366f1; text-decoration: underline; cursor: pointer; }
.icomposer { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border); background: var(--bg); }
.icomposer-actions { display: flex; gap: 8px; align-items: center; }
/* Enviar a la derecha, adjuntar y dictar a la izquierda. */
.icomposer-actions button[type="submit"] { margin-left: auto; }
.icomposer textarea {
  /* El alto lo maneja autosize() por JS; max-height es el tope a partir del
     cual sí scrollea, para que el composer no se coma el feed. */
  flex: 1; resize: none; max-height: 40vh; min-height: 40px;
  overflow-y: auto;
  padding: 9px 12px; border: 1.5px solid var(--border); border-radius: 20px;
  font-size: 0.95rem; line-height: 1.35; font-family: inherit;
  background: #fff; color: #212121; outline: none;
}
.icomposer textarea:focus { border-color: var(--accent); }
.imic {
  flex-shrink: 0; height: 40px; padding: 0 .9rem;
  border: 1.5px solid var(--border); border-radius: 20px;
  background: #fff; color: #212121; font-size: .9rem; font-weight: 600;
  line-height: 1; cursor: pointer;
}
.imic:disabled { opacity: .55; cursor: not-allowed; }
.iauto {
  flex-shrink: 0; width: 40px; height: 40px; padding: 0;
  border: 1.5px solid var(--border); border-radius: 50%;
  background: #fff; font-size: 1rem; line-height: 1; cursor: pointer;
  filter: grayscale(1); opacity: .55;
}
.iauto.on { filter: none; opacity: 1; border-color: #f59e0b; background: #fef3c7; }
.imic.on { border-color: #dc2626; background: #fee2e2; animation: imic-pulse 1.2s ease-in-out infinite; }
@keyframes imic-pulse { 50% { box-shadow: 0 0 0 6px rgba(220, 38, 38, .18); } }
@media (prefers-reduced-motion: reduce) { .imic.on { animation: none; } }
.iupload { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; flex-shrink: 0; border: 1.5px solid var(--border); border-radius: 50%; background: #fff; cursor: pointer; }
.iupload input { display: none; }
.iupload.disabled { opacity: .5; cursor: not-allowed; }
.icomposer button[type="submit"] { flex-shrink: 0; height: 40px; min-width: 78px; padding: 0 1rem; border: none; border-radius: 20px; background: var(--accent); color: #fff; font-weight: 700; cursor: pointer; }
.icomposer button[disabled] { opacity: .55; cursor: not-allowed; }
</style>
