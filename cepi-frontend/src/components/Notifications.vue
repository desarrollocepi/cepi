<template>
  <div class="notif" ref="rootEl">
    <button
      type="button"
      class="notif-bell"
      :class="{ has: badgeCount > 0 }"
      aria-label="Notificaciones"
      title="Notificaciones"
      @click="toggle"
    >
      🔔
      <span v-if="badgeCount > 0" class="notif-count">{{ badgeCount > 99 ? '99+' : badgeCount }}</span>
    </button>

    <div v-if="open" class="notif-panel">
      <div class="notif-head">
        <strong>Notificaciones</strong>
        <button type="button" class="notif-refresh" :disabled="busy" title="Refrescar" @click="load">↻</button>
      </div>

      <p v-if="error" class="notif-error">{{ error }}</p>
      <p v-if="busy && !items.length" class="notif-muted">Cargando…</p>
      <p v-else-if="!items.length" class="notif-muted">No tienes notificaciones.</p>

      <ul v-else class="notif-list">
        <li
          v-for="n in items"
          :key="n.id"
          class="notif-item"
          :class="['st-' + n.status, { done: n.status === 'done', clickable: !!n.entity_id }]"
          :role="n.entity_id ? 'button' : null"
          :title="n.entity_id ? 'Abrir el chat del paciente' : ''"
          @click="openReminder(n)"
        >
          <div class="ni-top">
            <span class="ni-title">{{ n.patient_name || n.title }}</span>
            <span class="ni-status" :title="'estado: ' + n.status">{{ statusLabel(n.status) }}</span>
          </div>
          <p v-if="n.created_by_name" class="ni-sub">↪️ Derivó: {{ n.created_by_name }}</p>
          <p v-if="n.message" class="ni-msg">{{ n.message }}</p>
          <div class="ni-foot">
            <span class="ni-due">{{ n._opening ? 'Abriendo…' : fmtDue(n.due_at) }}</span>
            <button
              v-if="n.status !== 'done' && n.status !== 'cancelled'"
              type="button"
              class="ni-done"
              :disabled="n._busy"
              @click.stop="markDone(n)"
            >{{ n._busy ? '…' : '✓ Visto' }}</button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { listReminders, completeReminder, resolveReminderPatient } from '../api.js';

const props = defineProps({ user: { type: Object, default: null } });
const emit = defineEmits(['open']);
const open = ref(false);
const items = ref([]);
const busy = ref(false);
const error = ref('');
const rootEl = ref(null);
let pollTimer = null;

// "Active" notifications = anything not yet acted on or cancelled.
const badgeCount = computed(() =>
  items.value.filter(n => n.status !== 'done' && n.status !== 'cancelled').length
);

function statusLabel(s) {
  return ({
    pending: 'pendiente', sent: 'enviada', snoozed: 'pospuesta',
    failed: 'sin entregar', done: 'visto', cancelled: 'cancelada',
  })[s] || s;
}

function fmtDue(d) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    return dt.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return String(d); }
}

async function load() {
  busy.value = true;
  error.value = '';
  try {
    // Personal: solo los recordatorios del propio usuario (aunque el rol pueda leer todos).
    const r = await listReminders({ owner_user_id: props.user?.id });
    const rows = Array.isArray(r?.data) ? r.data : [];
    items.value = rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // Enriquecer con el nombre del paciente (resuelve la entidad → episodio → paciente).
    const uniq = [...new Set(items.value.map(n => n.entity_id).filter(Boolean))];
    const map = {};
    await Promise.all(uniq.map(async eid => {
      try { const rr = await resolveReminderPatient(eid); if (rr?.patient_id) map[eid] = rr; } catch { /* ignore */ }
    }));
    items.value = items.value.map(n => ({
      ...n,
      patient_id: n.entity_id ? (map[n.entity_id]?.patient_id || null) : null,
      patient_name: n.entity_id ? (map[n.entity_id]?.patient_name || null) : null,
    }));
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    busy.value = false;
  }
}

function toggle() {
  open.value = !open.value;
  if (open.value) load();
}

// Click en una notificación → abre el chat del paciente que la origina.
// Resuelve la entidad del recordatorio (episodio → paciente) en el backend.
async function openReminder(n) {
  if (!n.entity_id || n._opening) return;
  // Usa el paciente ya resuelto en load(); si no, lo resuelve al vuelo.
  if (n.patient_id) {
    open.value = false;
    emit('open', { id: n.patient_id, name: n.patient_name || n.title || 'Paciente' });
    return;
  }
  n._opening = true;
  try {
    const r = await resolveReminderPatient(n.entity_id);
    if (r?.patient_id) {
      open.value = false;
      emit('open', { id: r.patient_id, name: r.patient_name || n.title || 'Paciente' });
    } else {
      error.value = 'No se encontró el paciente de esta notificación.';
    }
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    n._opening = false;
  }
}

async function markDone(n) {
  n._busy = true;
  try {
    await completeReminder(n.id, 'Visto desde el asistente');
    n.status = 'done';
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    n._busy = false;
  }
}

function onDocClick(ev) {
  if (open.value && rootEl.value && !rootEl.value.contains(ev.target)) open.value = false;
}

onMounted(() => {
  load();
  pollTimer = setInterval(load, 30000);
  document.addEventListener('click', onDocClick);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  document.removeEventListener('click', onDocClick);
});

defineExpose({ refresh: load });
</script>

<style scoped>
.notif { position: relative; display: inline-flex; }
.notif-bell {
  position: relative;
  background: rgba(255,255,255,0.18);
  color: #fff;
  border: 1.5px solid rgba(255,255,255,0.45);
  padding: 0.3rem 0.7rem;
  border-radius: 20px;
  font-size: 0.95rem;
  cursor: pointer;
  line-height: 1;
}
.notif-bell:hover { background: rgba(255,255,255,0.30); border-color: rgba(255,255,255,0.7); }
.notif-bell.has { border-color: #fde047; }
.notif-count {
  position: absolute; top: -6px; right: -6px;
  background: #ef4444; color: #fff;
  border-radius: 10px; padding: 0 5px;
  font-size: 0.62rem; font-weight: 800; line-height: 1.5;
  border: 1.5px solid #fff;
}
.notif-panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 80;
  width: min(360px, 92vw); max-height: 70vh; overflow-y: auto;
  background: #fff; color: var(--text);
  border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.25);
}
.notif-head {
  position: sticky; top: 0; background: #fff;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
}
.notif-refresh {
  border: 1px solid var(--border); background: var(--bg); color: var(--accent);
  border-radius: 6px; padding: 2px 9px; cursor: pointer;
}
.notif-error { color: #dc2626; font-size: 0.8rem; margin: 8px 14px; }
.notif-muted { color: var(--text-muted); font-size: 0.86rem; padding: 16px 14px; text-align: center; }
.notif-list { list-style: none; margin: 0; padding: 0; }
.notif-item { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.notif-item.clickable { cursor: pointer; }
.notif-item.clickable:hover { background: var(--bg); }
.notif-item.done { opacity: 0.55; }
.ni-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ni-title { font-weight: 700; font-size: 0.86rem; color: var(--text); }
.ni-status {
  flex-shrink: 0; font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.03em;
  padding: 1px 7px; border-radius: 10px; background: var(--bg); color: var(--text-muted); border: 1px solid var(--border);
}
.st-pending .ni-status { background: #fef9c3; color: #854d0e; border-color: #fde047; }
.st-sent .ni-status { background: #dcfce7; color: #166534; border-color: #86efac; }
.st-failed .ni-status { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
.ni-sub { margin: 3px 0 0; font-size: 0.78rem; color: var(--accent); font-weight: 600; }
.ni-msg { margin: 4px 0 0; font-size: 0.82rem; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; }
.ni-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.ni-due { font-size: 0.72rem; color: var(--text-muted); }
.ni-done {
  border: 1px solid var(--border); background: var(--bg); color: var(--accent);
  border-radius: 6px; padding: 3px 10px; font-size: 0.74rem; font-weight: 600; cursor: pointer;
}
.ni-done:hover:not(:disabled) { background: var(--accent); color: #fff; border-color: var(--accent); }
.ni-done:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
