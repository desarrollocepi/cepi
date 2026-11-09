<template>
  <!-- Alta del paciente (PAPER §35): cierra el caso. Si vuelve, es una consulta nueva. -->
  <div class="alta-modal" @click.self="!guardando && emit('close')">
    <form class="alta-panel" @submit.prevent="confirmar">
      <header class="alta-head">
        <h3>🏁 Dar de alta</h3>
        <button type="button" class="alta-x" :disabled="guardando" aria-label="Cerrar" @click="emit('close')">✕</button>
      </header>
      <p class="alta-ayuda">
        Se cierra esta consulta. Desde mañana {{ paciente || 'el paciente' }} no sale en la lista;
        se lo encuentra buscándolo o en el filtro «Alta». Si vuelve, se abre una consulta nueva
        con su propio motivo.
      </p>
      <label class="alta-campo">
        <span>Nota del alta <em>(opcional)</em></span>
        <textarea v-model="nota" rows="3" :disabled="guardando" placeholder="Ej.: Lesión resuelta, sin controles pendientes"></textarea>
      </label>
      <p v-if="error" class="alta-error">{{ error }}</p>
      <footer class="alta-pie">
        <button type="button" class="alta-sec" :disabled="guardando" @click="emit('close')">Cancelar</button>
        <button type="submit" class="alta-pri" :disabled="guardando">{{ guardando ? 'Guardando…' : 'Dar de alta' }}</button>
      </footer>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { darDeAlta } from '../api.js';

const props = defineProps({
  episodeId: { type: String, required: true },
  paciente: { type: String, default: '' },
});
const emit = defineEmits(['close', 'alta']);
const nota = ref('');
const guardando = ref(false);
const error = ref('');

async function confirmar() {
  guardando.value = true; error.value = '';
  try {
    await darDeAlta({ episodeId: props.episodeId, nota: nota.value });
    emit('alta');
  } catch (e) {
    error.value = e?.message || 'No se pudo dar el alta';
  } finally {
    guardando.value = false;
  }
}
</script>

<style scoped>
.alta-modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.alta-panel { width: min(480px, 100%); padding: 16px; background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.alta-head { display: flex; align-items: center; justify-content: space-between; }
.alta-head h3 { margin: 0; font-size: 16px; color: #0f766e; }
.alta-x { background: none; border: 0; font-size: 16px; cursor: pointer; }
.alta-ayuda { margin: 8px 0 12px; font-size: 13px; color: #475569; }
.alta-campo { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
.alta-campo em { font-weight: 400; color: #64748b; }
.alta-campo textarea { padding: 8px; font: inherit; font-weight: 400; border: 1px solid #cbd5e1; border-radius: 8px; resize: vertical; }
.alta-error { margin: 8px 0 0; font-size: 13px; color: #b91c1c; }
.alta-pie { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.alta-sec { padding: 7px 14px; background: #f1f5f9; border: 0; border-radius: 8px; cursor: pointer; }
.alta-pri { padding: 7px 14px; font-weight: 600; color: #fff; background: #0f766e; border: 0; border-radius: 8px; cursor: pointer; }
.alta-pri:disabled, .alta-sec:disabled { opacity: .6; cursor: not-allowed; }
</style>
