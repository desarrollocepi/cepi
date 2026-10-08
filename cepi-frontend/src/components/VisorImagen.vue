<!--
  Una imagen clínica a pantalla completa, con zoom: rueda, doble toque/clic, pellizco y
  arrastrar. La usan el chat (MessageContent) y la rejilla de imágenes (galería e Imágenes
  del paciente). Equivale a `VisorImagen.swift`.
-->
<template>
  <Teleport to="body">
    <div v-if="src" class="lightbox" @click.self="$emit('cerrar')" @wheel.prevent="onWheel">
      <button type="button" class="lb-close" @click="$emit('cerrar')" aria-label="Cerrar">✕</button>
      <img
        class="lb-img"
        :src="src" :alt="pie || 'Imagen clínica'"
        :style="{ transform: `translate(${tx}px,${ty}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'zoom-in' }"
        @click.stop
        @dblclick="onDbl"
        @pointerdown="onPointerDown" @pointermove="onPointerMove"
        @pointerup="onPointerUp" @pointercancel="onPointerUp"
        @touchstart="onTouchStart" @touchmove.prevent="onTouchMove" @touchend="onTouchEnd"
        draggable="false"
      />
      <div class="lb-hint">
        <span v-if="pie" class="lb-pie">{{ pie }}</span>
        Doble toque/clic para acercar · pellizca o rueda para zoom · arrastra para mover
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue';

const props = defineProps({
  /** URL de la imagen abierta; vacío = cerrado. */
  src: { type: String, default: '' },
  /** Texto al pie (paciente, fecha, diagnóstico). */
  pie: { type: String, default: '' },
});
const emit = defineEmits(['cerrar']);

const zoom = ref(1);
const tx = ref(0);
const ty = ref(0);
let drag = null;                // arrastre con puntero
let pinch = null;               // pellizco con dos dedos

function clampZoom(z) { return Math.min(6, Math.max(1, z)); }
function setZoom(z) { zoom.value = clampZoom(z); if (zoom.value === 1) { tx.value = 0; ty.value = 0; } }
function onWheel(e) { setZoom(zoom.value * (e.deltaY < 0 ? 1.15 : 0.87)); }
function onDbl() { setZoom(zoom.value > 1 ? 1 : 2.5); }
function onPointerDown(e) { if (zoom.value <= 1) return; drag = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }; }
function onPointerMove(e) { if (!drag) return; tx.value = drag.tx + (e.clientX - drag.x); ty.value = drag.ty + (e.clientY - drag.y); }
function onPointerUp() { drag = null; }
function tdist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
function onTouchStart(e) { if (e.touches.length === 2) { pinch = { d: tdist(e.touches), z: zoom.value }; } }
function onTouchMove(e) { if (pinch && e.touches.length === 2) setZoom(pinch.z * tdist(e.touches) / pinch.d); }
function onTouchEnd(e) { if (e.touches.length < 2) pinch = null; }
function onKey(e) { if (e.key === 'Escape') emit('cerrar'); }

// Otra imagen arranca sin zoom; Escape solo se escucha con el visor abierto.
watch(() => props.src, (v) => {
  zoom.value = 1; tx.value = 0; ty.value = 0; drag = null; pinch = null;
  if (v) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
}, { immediate: true });
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.lightbox {
  position: fixed; inset: 0; z-index: 1300;
  background: rgba(0, 0, 0, 0.9);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; touch-action: none;
}
.lb-img {
  max-width: 96vw; max-height: 92vh; object-fit: contain;
  transform-origin: center center; will-change: transform;
  user-select: none; -webkit-user-drag: none; touch-action: none;
}
.lb-close {
  position: fixed; top: 14px; right: 16px; z-index: 1301;
  width: 40px; height: 40px; border-radius: 50%; border: none;
  background: rgba(255, 255, 255, 0.2); color: #fff; font-size: 1.2rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.lb-close:hover { background: rgba(255, 255, 255, 0.35); }
.lb-hint {
  position: fixed; bottom: 14px; left: 0; right: 0; text-align: center;
  color: rgba(255, 255, 255, 0.7); font-size: 0.78rem; pointer-events: none; padding: 0 12px;
}
.lb-pie { display: block; margin-bottom: 4px; font-size: 0.85rem; color: #e2e8f0; }
</style>
