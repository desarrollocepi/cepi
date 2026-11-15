<template>
  <!-- Puerta tras el login (PAPER §37): sin aceptar la versión vigente de los términos no
       se pinta nada de la app ni se cargan datos. «No acepto» cierra la sesión. -->
  <div class="terminos-fondo">
    <div class="terminos" role="dialog" aria-modal="true" aria-labelledby="terminos-titulo">
      <h2 id="terminos-titulo">Términos y condiciones de uso</h2>
      <p class="intro">
        Antes de seguir, lee y acepta cómo se tratan tus datos personales y los de los pacientes,
        según la Ley Orgánica de Protección de Datos Personales del Ecuador.
        <span v-if="user?.terms_version">Los términos cambiaron desde que los aceptaste.</span>
      </p>
      <iframe class="texto" :src="TERMS_URL" title="Términos y condiciones de uso" />
      <a class="abrir" :href="TERMS_URL" target="_blank" rel="noopener">Abrir en otra pestaña ↗</a>
      <label class="casilla">
        <input v-model="read" type="checkbox" :disabled="saving" />
        Leí y acepto los términos y condiciones y la
        <a href="/privacidad.html" target="_blank" rel="noopener">Política de Privacidad</a>.
      </label>
      <p v-if="error" class="error" role="alert">No se pudo guardar tu aceptación: {{ error }}</p>
      <div class="acciones">
        <button type="button" class="secundario" :disabled="saving" @click="emit('reject')">
          No acepto · cerrar sesión
        </button>
        <button
          type="button" class="aceptar" :disabled="!read || saving"
          :title="!read ? 'Marca la casilla de lectura para aceptar' : ''"
          @click="accept"
        >{{ saving ? 'Guardando…' : 'Acepto' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { acceptTerms } from '../api.js';
import { TERMS_URL } from '../terms.js';

const props = defineProps({
  user: { type: Object, default: null },
  // Versión vigente leída de terminos.json: es la que queda registrada como aceptada.
  version: { type: String, required: true },
});
const emit = defineEmits(['accepted', 'reject']);

const read = ref(false);
const saving = ref(false);
const error = ref('');

async function accept() {
  if (!read.value || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const r = await acceptTerms(props.version);
    emit('accepted', r?.user || null);
  } catch (e) {
    error.value = e?.message || 'sin conexión con el servidor';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.terminos-fondo {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(15, 23, 42, .55);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.terminos {
  background: var(--surface, #fff); color: var(--text);
  border-radius: 8px; box-shadow: 0 10px 40px rgba(0, 0, 0, .3);
  width: 100%; max-width: 760px; max-height: 100%;
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px;
}
h2 { margin: 0; font-size: 18px; }
.intro { margin: 0; font-size: 13px; color: var(--text-muted); line-height: 1.45; }
.texto {
  flex: 1; min-height: 240px; height: 55vh; width: 100%;
  border: 1px solid var(--border); border-radius: 4px; background: #fff;
}
.abrir { align-self: flex-end; font-size: 12px; color: var(--accent); }
.casilla { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; line-height: 1.4; }
.casilla input { margin-top: 3px; }
.casilla a { color: var(--accent); }
.error { margin: 0; color: #b91c1c; font-size: 13px; }
.acciones { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.acciones button { padding: 9px 16px; border-radius: 4px; font-weight: 600; cursor: pointer; }
.acciones button[disabled] { opacity: .55; cursor: not-allowed; }
.aceptar { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
.secundario { background: transparent; color: var(--text); border: 1px solid var(--border); }
@media (max-width: 640px) {
  .terminos-fondo { padding: 0; }
  .terminos { border-radius: 0; height: 100%; }
  .texto { height: auto; }
  .acciones button { flex: 1; }
}
</style>
