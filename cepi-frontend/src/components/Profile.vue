<template>
  <div class="prof">
    <div class="prof-head">
      <button type="button" class="prof-back" @click="$emit('back')" title="Volver" aria-label="Volver">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      </button>
      <h2>Mi perfil</h2>
    </div>

    <p v-if="error" class="prof-err">{{ error }}</p>
    <p v-if="ok" class="prof-ok">{{ ok }}</p>

    <form class="prof-form" @submit.prevent="save">
      <label class="prof-field">
        <span>Nombre</span>
        <input v-model="name" type="text" placeholder="Tu nombre" required />
      </label>

      <label class="prof-field">
        <span>Email</span>
        <input :value="email" type="email" disabled title="El email no se puede cambiar aquí" />
        <small class="prof-hint">{{ role ? 'Rol: ' + role : '' }}</small>
      </label>

      <label class="prof-field">
        <span>Teléfono</span>
        <input v-model="phone" type="tel" placeholder="Ej. 099…" />
      </label>

      <label class="prof-field">
        <span>Cédula</span>
        <input v-model="cedula" type="text" placeholder="Nº de cédula" />
      </label>

      <div class="prof-pass">
        <button type="button" class="prof-pass-toggle" @click="showPass = !showPass">
          🔒 Cambiar contraseña {{ showPass ? '▲' : '▼' }}
        </button>
        <div v-if="showPass" class="prof-pass-body">
          <label class="prof-field">
            <span>Contraseña actual</span>
            <input v-model="currentPassword" type="password" autocomplete="current-password" placeholder="Tu contraseña actual" />
          </label>
          <label class="prof-field">
            <span>Nueva contraseña</span>
            <input v-model="newPassword" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres" />
          </label>
          <label class="prof-field">
            <span>Repetir nueva contraseña</span>
            <input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="Repite la nueva contraseña" />
          </label>
        </div>
      </div>

      <div class="prof-actions">
        <button type="submit" :disabled="busy">{{ busy ? 'Guardando…' : 'Guardar cambios' }}</button>
      </div>
    </form>

    <div class="prof-logout">
      <button type="button" class="prof-logout-btn" @click="$emit('logout')">Logout</button>
    </div>

    <div class="prof-delete">
      <EliminarCuenta @eliminada="$emit('logout')" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { updateProfile } from '../api.js';
import EliminarCuenta from './EliminarCuenta.vue';

const props = defineProps({ user: { type: Object, default: () => ({}) } });
const emit = defineEmits(['back', 'saved', 'logout']);

const name = ref(props.user?.name || '');
const email = ref(props.user?.email || '');
const role = ref(props.user?.role || '');
const phone = ref(props.user?.phone || '');
const cedula = ref(props.user?.cedula || '');

const showPass = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');

const busy = ref(false);
const error = ref('');
const ok = ref('');

async function save() {
  error.value = ''; ok.value = '';

  if (!name.value.trim()) { error.value = 'El nombre no puede estar vacío.'; return; }

  const patch = {
    name: name.value.trim(),
    phone: phone.value.trim(),
    cedula: cedula.value.trim(),
  };

  // Cambio de contraseña: solo si el usuario escribió una nueva.
  if (newPassword.value) {
    if (newPassword.value.length < 8) { error.value = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
    if (newPassword.value !== confirmPassword.value) { error.value = 'Las contraseñas nuevas no coinciden.'; return; }
    if (!currentPassword.value) { error.value = 'Ingresa tu contraseña actual para cambiarla.'; return; }
    patch.current_password = currentPassword.value;
    patch.new_password = newPassword.value;
  }

  busy.value = true;
  try {
    const res = await updateProfile(patch);
    ok.value = 'Perfil actualizado.';
    currentPassword.value = ''; newPassword.value = ''; confirmPassword.value = '';
    showPass.value = false;
    if (res?.user) {
      name.value = res.user.name || name.value;
      phone.value = res.user.phone || '';
      cedula.value = res.user.cedula || '';
      emit('saved', res.user);
    }
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.prof { max-width: 520px; margin: 14px auto; padding: 0 14px 24px; color: var(--text); height: 100%; overflow: auto; }
.prof-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.prof-head h2 { margin: 0; color: var(--accent); font-size: 1.15rem; }
.prof-back {
  flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid var(--border); background: #fff; color: var(--accent);
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.prof-back:hover { border-color: var(--accent); }
.prof-err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; }
.prof-ok  { color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px 12px; }
.prof-form { display: flex; flex-direction: column; gap: 14px; }
.prof-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
.prof-field input {
  padding: 9px 11px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--text); font-size: 0.95rem; font-weight: 500;
}
.prof-field input:disabled { opacity: .65; cursor: not-allowed; }
.prof-field input:focus { outline: none; border-color: var(--accent); }
.prof-hint { font-weight: 500; color: var(--text-muted); font-size: 0.78rem; }
.prof-pass { border: 1px solid var(--border); border-radius: 10px; padding: 4px; background: var(--bg); }
.prof-pass-toggle {
  width: 100%; text-align: left; background: none; border: none; color: var(--text);
  padding: 8px 10px; font-weight: 700; cursor: pointer; font-size: 0.9rem;
}
.prof-pass-body { display: flex; flex-direction: column; gap: 12px; padding: 4px 10px 10px; }
.prof-actions { display: flex; justify-content: flex-end; margin-top: 4px; }
.prof-actions button {
  padding: 10px 20px; background: var(--accent); color: #fff; border: none;
  border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.95rem;
}
.prof-actions button:disabled { opacity: .6; cursor: not-allowed; }
.prof-logout { margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; justify-content: center; }
.prof-logout-btn {
  padding: 9px 22px; background: #fff; color: #b91c1c; border: 1px solid #fecaca;
  border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.9rem;
}
.prof-logout-btn:hover { background: #fef2f2; border-color: #b91c1c; }
.prof-delete { margin-top: 18px; }
</style>
