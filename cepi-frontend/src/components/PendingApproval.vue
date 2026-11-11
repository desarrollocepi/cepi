<template>
  <div class="pending">
    <div class="box">
      <div class="emoji">⏳</div>
      <h1>Cuenta pendiente de aprobación</h1>
      <p>Recibimos tu registro. Un administrador debe aprobar tu cuenta antes de que puedas usar la aplicación.</p>
      <p class="muted">Te avisaremos cuando esté lista.</p>
      <!-- Si ya tiene rol en otra organización, entra a ella a propósito: la sesión
           nunca lo lleva sola a otra org (PAPER §13.8). -->
      <div v-if="otherOrgs.length" class="otras">
        <p class="muted">Ya tienes acceso en:</p>
        <button
          v-for="o in otherOrgs"
          :key="o.id"
          class="entrar"
          :disabled="switching"
          :title="switching ? 'Cambiando de organización…' : `Entrar a ${o.name}`"
          @click="$emit('switch-org', o.id)"
        >Entrar a {{ o.name }}</button>
      </div>
      <button class="link" @click="$emit('logout')">Cerrar sesión</button>
      <!-- Una cuenta recién creada con Google cae acá: también tiene que poder borrarse. -->
      <EliminarCuenta @eliminada="$emit('logout')" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import EliminarCuenta from './EliminarCuenta.vue';

const props = defineProps({
  user: { type: Object, default: null },
  switching: { type: Boolean, default: false },
});
defineEmits(['logout', 'switch-org']);

// Orgs reales (no sandbox) donde ya tiene un rol, distintas de la activa.
const otherOrgs = computed(() => (props.user?.orgs || [])
  .filter((o) => o.approved && !o.sandbox && o.id !== props.user?.org_id));
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
.otras { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.entrar {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.entrar:disabled { opacity: 0.6; cursor: default; }
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
