<template>
  <!-- Navegador entre los episodios del paciente (PAPER §28.4.1): en Chat, Evolución e
       Imágenes, debajo de las pestañas. La Ficha trae el suyo, con lo que cambió respecto
       del episodio anterior. Sale siempre: con un episodio solo, lo dice. -->
  <nav class="epnav">
    <button
      class="epnav-btn" type="button" :disabled="!hayAnterior" @click="paso(1)"
      :title="hayAnterior ? 'Ver el episodio anterior de este paciente' : (visitas.length ? 'Es el primer episodio' : 'No hay otros episodios')"
    >‹ Anterior</button>
    <span class="epnav-pos">
      <strong v-if="idx >= 0">Episodio {{ visitas.length - idx }} de {{ visitas.length }}</strong>
      <strong v-else>Episodio</strong>
      <span v-if="actual" class="epnav-fecha">{{ fecha(actual) }}</span>
      <span v-if="actual && motivo(actual)" class="epnav-motivo">{{ motivo(actual) }}</span>
      <em v-if="cargando && !visitas.length">buscando los episodios…</em>
      <em v-else-if="!visitas.length">este paciente todavía no tiene episodios</em>
      <em v-else-if="visitas.length === 1">único episodio registrado de este paciente</em>
    </span>
    <button
      class="epnav-btn" type="button" :disabled="!haySiguiente" @click="paso(-1)"
      :title="haySiguiente ? 'Ver el episodio siguiente de este paciente' : (visitas.length ? 'Es el episodio más reciente' : 'No hay otros episodios')"
    >Siguiente ›</button>
  </nav>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  /** Las visitas (episodios) del paciente, de la más nueva a la más vieja. */
  visitas: { type: Array, default: () => [] },
  episodeId: { type: String, default: null },
  cargando: { type: Boolean, default: false },
});
const emit = defineEmits(['navegar']);

const idx = computed(() => props.visitas.findIndex((v) => v.id === props.episodeId));
const actual = computed(() => (idx.value >= 0 ? props.visitas[idx.value] : null));
const hayAnterior = computed(() => idx.value >= 0 && idx.value < props.visitas.length - 1);
const haySiguiente = computed(() => idx.value > 0);

function paso(dir) {
  const n = idx.value + dir;
  if (n >= 0 && n < props.visitas.length) emit('navegar', props.visitas[n].id);
}
const fecha = (v) => String(v?.fecha || v?.data?.fecha || '').slice(0, 10);
const motivo = (v) => v?.motivo_consulta || v?.data?.motivo_consulta || v?.motivo || '';
</script>

<style scoped>
.epnav { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border, #e2e8f0); background: var(--surface, #f8fafc); font-size: 13px; }
.epnav-pos { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; justify-content: center; text-align: center; }
.epnav-fecha { opacity: .75; }
.epnav-motivo { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.epnav-pos em { opacity: .7; font-size: 12px; }
.epnav-btn { flex-shrink: 0; padding: 4px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; background: var(--bg, #fff); color: inherit; cursor: pointer; font-size: 13px; }
.epnav-btn:disabled { opacity: .45; cursor: default; }
</style>
