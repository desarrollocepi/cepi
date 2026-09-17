<template>
  <div class="pending">
    <div class="box">
      <div class="emoji">⏳</div>
      <h1>Cuenta pendiente de aprobación</h1>
      <p>Recibimos tu registro. Un administrador debe aprobar tu cuenta antes de que puedas usar la aplicación.</p>
      <p class="muted">Te avisaremos cuando esté lista.</p>
      <button class="link" @click="$emit('logout')">Cerrar sesión</button>
      <!-- Una cuenta recién creada con Google cae acá: también tiene que poder borrarse. -->
      <EliminarCuenta @eliminada="$emit('logout')" />
    </div>
  </div>
</template>

<script setup>
import EliminarCuenta from './EliminarCuenta.vue';

defineEmits(['logout']);
</script>

<style scoped>
.pending {
  height: 100dvh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg);
  color: var(--text);
}
.box {
  max-width: 420px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.emoji { font-size: 48px; line-height: 1; }
.box h1 { margin: 0; font-size: 1.4rem; color: var(--accent); }
.box p { margin: 0; line-height: 1.5; }
.box p.muted { color: var(--text-muted); font-size: 0.9rem; }
.link {
  margin-top: 12px;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 14px;
  text-decoration: underline;
}
</style>
