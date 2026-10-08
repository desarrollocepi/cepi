<template>
  <form class="card" @submit.prevent="submit">
    <h2>Crear cuenta</h2>
    <label>Nombre completo
      <input v-model.trim="name" type="text" autocomplete="name" required />
    </label>
    <label>Email
      <input v-model.trim="email" type="email" autocomplete="email" required />
    </label>
    <label>Teléfono
      <input v-model.trim="phone" type="tel" autocomplete="tel" />
    </label>
    <label>Cédula
      <input v-model.trim="cedula" type="text" autocomplete="off" />
    </label>
    <label>Contraseña
      <input v-model="password" type="password" autocomplete="new-password" minlength="8" required />
    </label>
    <button type="submit" :disabled="busy">{{ busy ? 'Creando…' : 'Crear cuenta' }}</button>
    <p v-if="error" class="error">{{ error }}</p>
    <p class="hint">
      <a href="#" @click.prevent="$emit('go-login')">← Volver a ingresar</a>
    </p>
  </form>
</template>

<script setup>
import { ref } from 'vue';
import { register } from '../api.js';

const emit = defineEmits(['go-login', 'registered']);

const name = ref('');
const email = ref('');
const phone = ref('');
const cedula = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await register({
      name: name.value,
      email: email.value,
      password: password.value,
      phone: phone.value,
      cedula: cedula.value,
    });
    // → pantalla de código (sin links en el email)
    emit('registered', email.value.trim().toLowerCase());
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.card {
  max-width: 360px; margin: 48px auto; padding: 24px;
  background: var(--bot-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex; flex-direction: column; gap: 12px;
  color: var(--text);
}
.card h2 { margin: 0 0 8px; color: var(--accent); }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--text-muted); }
input {
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px;
  font-size: 14px; background: var(--bg); color: var(--text);
}
input:focus { outline: none; border-color: var(--accent); }
button {
  padding: 10px 14px; background: var(--accent); color: #fff; border: none;
  border-radius: 4px; font-weight: 600; cursor: pointer;
  transition: background .15s ease;
}
button:hover:not([disabled]) { background: var(--accent-hover, #4da8cf); }
button[disabled] { opacity: .6; cursor: not-allowed; }
.error { color: #dc2626; font-size: 13px; margin: 4px 0 0; }
.ok { color: var(--text); font-size: 14px; line-height: 1.5; }
.hint { color: var(--text-muted); font-size: 13px; margin: 4px 0 0; }
.hint a { color: var(--accent); text-decoration: none; }
</style>
