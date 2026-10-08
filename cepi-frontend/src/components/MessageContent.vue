<!--
  Renders a chat turn's text, expanding inline [img:<attachment_id>] markers
  into thumbnails. The bot emits those markers in the "mostrar resultados
  imagen" reply so each clinical image is shown right above its results.

  The root keeps class `content` so the parent (Chat.vue) bubble styling —
  `.turn.user .content` / `.turn.assistant .content` — still applies (Vue
  passes the parent scope id onto a child component's root element).
-->
<template>
  <div class="content">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.type === 'text'" class="seg-text">{{ seg.text }}</span>
      <img
        v-else-if="blobUrls[seg.id]"
        class="seg-img"
        :src="blobUrls[seg.id]"
        :alt="seg.name || 'Imagen clínica'"
        :title="seg.name || 'Ampliar'"
        @click="lightbox = blobUrls[seg.id]"
      />
      <span v-else class="seg-loading">🖼️ cargando imagen…</span>
    </template>

    <VisorImagen :src="lightbox" @cerrar="lightbox = ''" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { fetchAttachmentObjectUrl } from '../api.js';
import VisorImagen from './VisorImagen.vue';

const props = defineProps({ content: { type: String, default: '' } });

// Soporta dos marcadores de imagen: `[img:<uuid>]` (lo emite el bot) y
// `[adjunto: <nombre> · <uuid>]` (lo emite el uploader del chat). Ambos se
// renderizan inline para ver las imágenes (lesión/consentimiento) sin abrirlas.
const SEG_RE = /\[img:([0-9a-f-]{36})\]|\[adjunto:\s*([^·\]]+?)\s*·\s*([0-9a-f-]{36})\s*\]/gi;

// Split the content into ordered text / image segments.
const segments = computed(() => {
  const out = [];
  let last = 0;
  const re = new RegExp(SEG_RE);
  let m;
  while ((m = re.exec(props.content)) !== null) {
    const before = props.content.slice(last, m.index).replace(/\s+$/, '');
    if (before) out.push({ type: 'text', text: before });
    const id = (m[1] || m[3] || '').toLowerCase();
    out.push({ type: 'image', id, name: (m[2] || '').trim() });
    last = m.index + m[0].length;
  }
  const rest = props.content.slice(last).replace(/^\n+/, '');
  if (rest) out.push({ type: 'text', text: rest });
  return out.length ? out : [{ type: 'text', text: props.content }];
});

const blobUrls = ref({});

async function loadImages() {
  for (const seg of segments.value) {
    if (seg.type !== 'image' || blobUrls.value[seg.id]) continue;
    try {
      const url = await fetchAttachmentObjectUrl(`/api/attachments/${seg.id}/file`);
      blobUrls.value = { ...blobUrls.value, [seg.id]: url };
    } catch { /* leave as "cargando…" */ }
  }
}
watch(() => props.content, loadImages, { immediate: true });

const lightbox = ref('');     // object URL de la imagen abierta en el visor, o ''

onUnmounted(() => {
  for (const u of Object.values(blobUrls.value)) {
    try { URL.revokeObjectURL(u); } catch { /* already revoked */ }
  }
});
</script>

<style scoped>
.seg-text { white-space: pre-wrap; word-break: break-word; }
.seg-img {
  display: block;
  max-width: 240px;
  max-height: 240px;
  margin: 6px 0;
  border-radius: 8px;
  border: 1px solid var(--border, #d4d4d8);
  object-fit: cover;
  cursor: zoom-in;
}
.seg-loading { display: block; margin: 6px 0; color: #94a3b8; font-style: italic; }
</style>
