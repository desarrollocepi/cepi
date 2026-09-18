<template>
  <!-- Galería de la organización activa: las imágenes de todos los casos, con buscador
       (PAPER §24.2.1, D-Aux-22). Misma estructura que la pestaña Galería de la app iOS. -->
  <section class="gal">
    <header class="gal-head">
      <h2>Galería</h2>
      <input
        v-model="q" class="gal-buscar" type="search"
        placeholder="Paciente, cédula, diagnóstico, CIE-10 o fecha"
        aria-label="Buscar en la galería"
      />
    </header>
    <RejillaImagenes :q="q" class="gal-rejilla" vacio="Todavía no hay imágenes en esta organización" />
  </section>
</template>

<script setup>
import { ref } from 'vue';
import RejillaImagenes from './RejillaImagenes.vue';

const q = ref('');
</script>

<style scoped>
.gal { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.gal-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.gal-head h2 { margin: 0; font-size: 1.05rem; color: var(--accent); }
.gal-buscar { flex: 1; min-width: 220px; padding: 8px 12px; font-size: 14px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.gal-buscar:focus { outline: none; border-color: var(--accent); }
.gal-rejilla { flex: 1; min-height: 0; }
</style>
