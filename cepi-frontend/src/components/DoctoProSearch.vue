<template>
  <div class="dp-modal" @click.self="$emit('close')">
    <div class="dp-panel">
      <div class="dp-head">
        <strong>🔎 DoctoPro — consulta de pacientes</strong>
        <button type="button" @click="$emit('close')">Cerrar</button>
      </div>

      <input
        ref="inp" v-model="q" class="dp-search" type="text" autocomplete="off"
        placeholder="Buscar por nombre o apellido…" @input="onInput"
      />

      <p v-if="error" class="dp-error">{{ error }}</p>

      <!-- Detalle de un paciente -->
      <div v-if="selected" class="dp-detail">
        <button type="button" class="dp-back" @click="selected = null">‹ Volver a resultados</button>
        <h3>{{ selected.nombre }} {{ selected.apellido }}</h3>
        <dl class="dp-fields">
          <template v-for="f in detailFields" :key="f.k">
            <dt>{{ f.label }}</dt><dd>{{ selected[f.k] || '—' }}</dd>
          </template>
        </dl>
        <p class="dp-src">Fuente: DoctoPro · id {{ selected.id }}</p>
      </div>

      <!-- Resultados -->
      <template v-else>
        <p v-if="loading" class="dp-muted">Buscando…</p>
        <p v-else-if="q.length >= 2 && !results.length" class="dp-muted">Sin resultados para “{{ q }}”.</p>
        <p v-else-if="q.length < 2" class="dp-muted">Escribe al menos 2 letras.</p>
        <ul v-else class="dp-list">
          <li v-for="p in results" :key="p.id">
            <button type="button" class="dp-item" @click="open(p)">
              <span class="dp-name">👤 {{ p.value }}</span>
              <span class="dp-meta">{{ p.cedula || 's/cédula' }}<span v-if="p.telefono"> · {{ p.telefono }}</span></span>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { searchDoctoProPatients, getDoctoProPatient } from '../api.js';

defineEmits(['close']);

const q = ref('');
const results = ref([]);
const selected = ref(null);
const loading = ref(false);
const error = ref('');
const inp = ref(null);
let timer = null;
let seq = 0;

const detailFields = [
  { k: 'cedula', label: 'Cédula' },
  { k: 'telefono', label: 'Teléfono' },
  { k: 'celular', label: 'Celular' },
  { k: 'email', label: 'Email' },
  { k: 'fechaDeNacimiento', label: 'Nacimiento' },
  { k: 'ocupacion', label: 'Ocupación' },
  { k: 'direccion', label: 'Dirección' },
];

onMounted(() => inp.value?.focus());

function onInput() {
  clearTimeout(timer);
  const term = q.value.trim();
  if (term.length < 2) { results.value = []; loading.value = false; return; }
  loading.value = true;
  timer = setTimeout(() => run(term), 280);
}

async function run(term) {
  const mine = ++seq;
  error.value = '';
  try {
    const r = await searchDoctoProPatients(term);
    if (mine !== seq) return;
    results.value = r.pacientes || [];
  } catch (e) {
    if (mine !== seq) return;
    // El código viaja en el error; el mensaje del backend no siempre lo nombra.
    error.value = (e?.status === 503 || /503/.test(e?.message || '')) ? 'Integración DoctoPro no configurada.' : 'No se pudo consultar DoctoPro.';
    results.value = [];
  } finally {
    if (mine === seq) loading.value = false;
  }
}

async function open(p) {
  selected.value = { ...p };          // muestra lo básico al instante
  error.value = '';
  try {
    const r = await getDoctoProPatient(p.id);
    if (r.usuario) selected.value = { ...p, ...r.usuario, value: p.value };
  } catch { /* nos quedamos con los básicos */ }
}
</script>

<style scoped>
.dp-modal { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 16px; }
.dp-panel {
  background: var(--bot-bg, #fff); color: var(--text); border: 1px solid var(--border);
  border-radius: 10px; width: 100%; max-width: 440px; max-height: 82vh;
  display: flex; flex-direction: column; padding: 16px; gap: 12px; overflow: hidden;
}
.dp-head { display: flex; align-items: center; justify-content: space-between; }
.dp-head strong { color: var(--accent); }
.dp-head button { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; color: var(--text); cursor: pointer; }
.dp-search {
  padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 8px;
  font-size: 15px; background: var(--bg); color: var(--text); width: 100%;
}
.dp-search:focus { outline: none; border-color: var(--accent); }
.dp-error { color: #dc2626; font-size: 13px; margin: 0; }
.dp-muted { color: var(--text-muted); font-size: 14px; margin: 4px 0; text-align: center; }
.dp-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.dp-item {
  width: 100%; text-align: left; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 9px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; color: var(--text);
}
.dp-item:hover { border-color: var(--accent); }
.dp-name { font-weight: 600; }
.dp-meta { font-size: 12px; color: var(--text-muted); }
.dp-detail { overflow-y: auto; }
.dp-back { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0 0 8px; font-size: 13px; }
.dp-detail h3 { margin: 0 0 10px; color: var(--text); }
.dp-fields { display: grid; grid-template-columns: 110px 1fr; gap: 6px 10px; margin: 0; font-size: 14px; }
.dp-fields dt { color: var(--text-muted); }
.dp-fields dd { margin: 0; color: var(--text); word-break: break-word; }
.dp-src { color: var(--text-muted); font-size: 11px; margin: 14px 0 0; }
</style>
