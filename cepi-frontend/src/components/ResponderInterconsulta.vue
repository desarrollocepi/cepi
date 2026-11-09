<template>
  <!-- Responder la interconsulta (feedback de las dermatólogas, 2026-11-09): la respuesta
       queda en la ficha y en la evolución, no solo en el chat, y la campana de "revisar"
       se apaga. Viene precargado con lo que la ficha ya tiene; un campo vacío no borra. -->
  <div class="ri-modal" @click.self="!guardando && emit('close')">
    <form class="ri-panel" @submit.prevent="enviar">
      <header class="ri-head">
        <strong>Responder interconsulta</strong>
        <button type="button" class="ri-x" :disabled="guardando" aria-label="Cerrar" @click="emit('close')">✕</button>
      </header>
      <p class="ri-ayuda">Se guarda en la ficha de esta consulta y le llega al médico que envió el caso.</p>

      <label class="ri-campo">
        <span>Diagnóstico clínico</span>
        <input v-model="diagnostico" type="text" :disabled="guardando" placeholder="Ej.: D22.5 — Nevus atípico" />
      </label>
      <fieldset class="ri-prioridad" :disabled="guardando">
        <legend>Prioridad clínica</legend>
        <label v-for="o in PRIORIDADES" :key="o.valor" class="ri-prio" :class="[`ri-prio-${o.valor.toLowerCase()}`, { on: prioridad === o.valor }]" :title="o.guia">
          <input v-model="prioridad" type="radio" name="prioridad" :value="o.valor" />
          <strong>{{ o.valor }}</strong>
          <small>{{ o.guia }}</small>
        </label>
      </fieldset>
      <label class="ri-campo">
        <span>Tratamiento</span>
        <textarea v-model="tratamiento" rows="2" :disabled="guardando"></textarea>
      </label>
      <label class="ri-campo">
        <span>Respuesta e indicaciones <em>(obligatoria)</em></span>
        <textarea v-model="recomendacion" rows="4" :disabled="guardando" placeholder="Qué debe hacer el médico que envió el caso"></textarea>
      </label>
      <label class="ri-campo">
        <span>Observaciones</span>
        <textarea v-model="observaciones" rows="2" :disabled="guardando" placeholder="Resumen de lo más importante (sale en la evolución)"></textarea>
      </label>

      <p v-if="error" class="ri-error">{{ error }}</p>
      <footer class="ri-pie">
        <button type="button" class="ri-sec" :disabled="guardando" @click="emit('close')">Cancelar</button>
        <button
          type="submit" class="ri-pri" :disabled="guardando || !recomendacion.trim()"
          :title="!recomendacion.trim() ? 'Escribe la respuesta para el médico que envió el caso' : 'Guardar en la ficha y avisar'"
        >{{ guardando ? 'Guardando…' : 'Responder' }}</button>
      </footer>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { responderInterconsulta } from '../api.js';

const props = defineProps({
  episodeId: { type: String, required: true },
  /** Lo que la ficha ya tiene, para precargar. */
  inicial: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['close', 'respondida']);

const diagnostico = ref(props.inicial.diagnostico || '');
const tratamiento = ref(props.inicial.tratamiento_resumen || '');
const observaciones = ref(props.inicial.observaciones || '');
const prioridad = ref(props.inicial.prioridad || '');
// PAPER §34: la tabla del documento, abreviada. La decisión es del médico responsable.
const PRIORIDADES = [
  { valor: 'Urgente', guia: 'Compromiso general, ampollas extensas, reacción grave a fármacos, eritrodermia, púrpura que progresa → supervisor y atención presencial ya' },
  { valor: 'Preferente', guia: 'Sospecha de cáncer, crecimiento rápido, úlcera o sangrado persistente, inmunosuprimido → ruta prioritaria' },
  { valor: 'Programada', guia: 'Estable, sin alarma, o control de algo ya evaluado → seguimiento según plazo' },
];
const recomendacion = ref('');
const guardando = ref(false);
const error = ref('');

async function enviar() {
  if (!recomendacion.value.trim()) return;
  guardando.value = true; error.value = '';
  try {
    const r = await responderInterconsulta({
      episodeId: props.episodeId, recomendacion: recomendacion.value,
      diagnostico: diagnostico.value, tratamiento: tratamiento.value, observaciones: observaciones.value,
      prioridad: prioridad.value,
    });
    emit('respondida', { notificado: !!r?.notified });
  } catch (e) {
    error.value = e?.message || 'No se pudo guardar la respuesta';
  } finally {
    guardando.value = false;
  }
}
</script>

<style scoped>
.ri-modal { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.5); }
.ri-panel { width: min(560px, 96vw); max-height: 96vh; overflow: auto; padding: 14px 16px; background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.3); }
.ri-head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; color: #0f172a; }
.ri-x { border: 0; background: none; font-size: 16px; cursor: pointer; color: #475569; }
.ri-ayuda { margin: 4px 0 10px; font-size: 12px; color: #64748b; }
.ri-campo { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 13px; font-weight: 600; color: #334155; }
.ri-campo em { font-weight: 400; color: #b45309; font-style: normal; }
.ri-campo input, .ri-campo textarea { padding: 7px 8px; font: inherit; font-weight: 400; border: 1px solid #cbd5e1; border-radius: 6px; resize: vertical; }
.ri-error { margin: 0 0 8px; font-size: 13px; color: #b91c1c; }
.ri-pie { display: flex; justify-content: flex-end; gap: 8px; }
.ri-pie button { padding: 7px 14px; font-weight: 600; border-radius: 6px; cursor: pointer; }
.ri-sec { color: #334155; background: #f8fafc; border: 1px solid #cbd5e1; }
.ri-pri { color: #fff; background: #16a34a; border: 1px solid #16a34a; }
.ri-pri:disabled, .ri-sec:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 560px) { .ri-modal { padding: 0; } .ri-panel { width: 100vw; height: 100dvh; max-height: none; border-radius: 0; } }
.ri-prioridad { display: flex; flex-direction: column; gap: 6px; margin: 0 0 10px; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; }
.ri-prioridad legend { padding: 0 4px; font-size: 13px; font-weight: 600; }
.ri-prio { display: grid; grid-template-columns: auto auto 1fr; gap: 6px; align-items: baseline; padding: 5px 8px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; font-size: 13px; }
.ri-prio small { color: #64748b; font-size: 12px; }
.ri-prio.on { border-color: currentColor; }
.ri-prio-urgente strong { color: #b91c1c; }
.ri-prio-preferente strong { color: #b45309; }
.ri-prio-programada strong { color: #15803d; }
</style>
