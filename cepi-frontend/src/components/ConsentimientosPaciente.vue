<template>
  <!-- Consentimientos del paciente (PAPER §31): dos recuadros propios, separados de las
       fotos clínicas, cada uno con sus fotos firmadas y su botón para subir. -->
  <section class="cons" aria-label="Consentimientos del paciente">
    <div v-for="t in TIPOS" :key="t.id" class="cons-caja" :data-tipo="t.id">
      <header class="cons-cab">
        <div>
          <h3 class="cons-titulo">{{ t.titulo }}</h3>
          <p class="cons-quien">{{ t.quien }}</p>
        </div>
        <label class="cons-subir" :class="{ 'cons-subir-off': !!subiendo || !cargado }"
               :title="motivoSubir(t.id)">
          <input type="file" accept="image/*" multiple class="cons-input"
                 :disabled="!!subiendo || !cargado" :aria-label="`Subir foto del ${t.titulo.toLowerCase()}`"
                 @change="subir(t.id, $event)" />
          {{ subiendo === t.id ? 'Subiendo…' : '📷 Subir foto' }}
        </label>
      </header>

      <p v-if="!cargado && !error" class="cons-estado">Cargando…</p>
      <p v-else-if="error" class="cons-estado cons-error">
        {{ error }} <button type="button" class="cons-reintentar" @click="cargar">Reintentar</button>
      </p>
      <p v-else-if="!filas[t.id].length" class="cons-estado">Todavía no hay foto</p>
      <div v-else class="cons-fotos">
        <button v-for="f in filas[t.id]" :key="f.id" type="button" class="cons-foto"
                :disabled="!urls[f.attachment_id]"
                :title="f.attachment_id ? '' : 'Registro anterior sin foto guardada'"
                @click="abierta = { ...f, titulo: t.titulo }">
          <img v-if="urls[f.attachment_id]" :src="urls[f.attachment_id]" :alt="t.titulo" loading="lazy" />
          <span v-else class="cons-ph">{{ f.attachment_id ? (rotas[f.attachment_id] ? 'No disponible' : 'Cargando…') : 'Sin foto' }}</span>
          <span class="cons-fecha">{{ f.fecha || '' }}</span>
        </button>
      </div>
      <p v-if="aviso[t.id]" class="cons-aviso" :class="{ 'cons-error': avisoError[t.id] }">{{ aviso[t.id] }}</p>
    </div>

    <VisorImagen
      :src="abierta ? urls[abierta.attachment_id] : ''"
      :pie="abierta ? [abierta.titulo, abierta.fecha].filter(Boolean).join(' · ') : ''"
      @cerrar="abierta = null"
    />
  </section>
</template>

<script setup>
import { ref, reactive, watch, onUnmounted } from 'vue';
import { listarConsentimientos, guardarConsentimientos, uploadAttachment, fetchAttachmentObjectUrl } from '../api.js';
import VisorImagen from './VisorImagen.vue';

const props = defineProps({
  patientId: { type: String, required: true },
});

const TIPOS = [
  { id: 'informado', titulo: 'Consentimiento informado', quien: 'Lo firma el paciente' },
  { id: 'privacidad_datos', titulo: 'Privacidad de los datos', quien: 'Lo firma el profesional que atiende' },
];

const filas = reactive({ informado: [], privacidad_datos: [] });
const urls = ref({});
const rotas = ref({});
const cargado = ref(false);
const error = ref('');
const subiendo = ref('');
const abierta = ref(null);
const aviso = reactive({ informado: '', privacidad_datos: '' });
const avisoError = reactive({ informado: false, privacidad_datos: false });

function motivoSubir(tipo) {
  if (!cargado.value) return 'Espera a que carguen los consentimientos';
  if (subiendo.value && subiendo.value !== tipo) return 'Termina primero la otra subida';
  if (subiendo.value) return 'Subiendo…';
  return 'Sube la foto de la hoja firmada';
}

async function cargarFotos() {
  const todas = [...filas.informado, ...filas.privacidad_datos]
    .map((f) => f.attachment_id)
    .filter((id) => id && !urls.value[id] && !rotas.value[id]);
  await Promise.all(todas.map(async (id) => {
    try { urls.value[id] = await fetchAttachmentObjectUrl(`/api/attachments/${id}/file`); }
    catch { rotas.value[id] = true; }
  }));
}

async function cargar() {
  error.value = '';
  try {
    const r = await listarConsentimientos(props.patientId);
    filas.informado = r?.informado || [];
    filas.privacidad_datos = r?.privacidad_datos || [];
    cargado.value = true;
    await cargarFotos();
  } catch (e) {
    error.value = `No se pudieron cargar los consentimientos: ${e?.message || 'sin conexión'}`;
  }
}

async function subir(tipo, ev) {
  const archivos = Array.from(ev.target?.files || []);
  if (ev.target) ev.target.value = '';
  if (!archivos.length) return;
  subiendo.value = tipo;
  aviso[tipo] = '';
  avisoError[tipo] = false;
  try {
    const ids = [];
    for (const f of archivos) {
      const att = await uploadAttachment(f);
      if (att?.id) ids.push(att.id);
    }
    await guardarConsentimientos({ patientId: props.patientId, tipo, attachmentIds: ids });
    aviso[tipo] = ids.length === 1 ? 'Foto guardada' : `${ids.length} fotos guardadas`;
    await cargar();
  } catch (e) {
    avisoError[tipo] = true;
    aviso[tipo] = `No se pudo guardar: ${e?.message || 'error'}`;
  } finally {
    subiendo.value = '';
  }
}

watch(() => props.patientId, () => {
  cargado.value = false;
  filas.informado = [];
  filas.privacidad_datos = [];
  cargar();
}, { immediate: true });

onUnmounted(() => {
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url);
});
</script>

<style scoped>
.cons { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; padding: 10px 10px 0; }
.cons-caja { display: flex; flex-direction: column; gap: 8px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
.cons-cab { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.cons-titulo { margin: 0; font-size: 14px; font-weight: 700; color: #0f172a; }
.cons-quien { margin: 2px 0 0; font-size: 12px; color: #64748b; }
.cons-subir { flex: none; position: relative; padding: 6px 12px; font-size: 13px; font-weight: 600; color: #fff; background: #0ea5e9; border-radius: 6px; cursor: pointer; }
.cons-subir-off { background: #94a3b8; cursor: not-allowed; }
.cons-input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: inherit; }
.cons-estado { margin: 0; font-size: 13px; color: #94a3b8; }
.cons-error { color: #b91c1c; }
.cons-reintentar { margin-left: 6px; font-size: 12px; color: #0369a1; background: none; border: 0; text-decoration: underline; cursor: pointer; }
.cons-fotos { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
.cons-foto { display: flex; flex-direction: column; gap: 2px; padding: 0; background: none; border: 0; cursor: pointer; text-align: left; }
.cons-foto:disabled { cursor: default; }
.cons-foto img, .cons-ph { width: 100%; height: 90px; object-fit: cover; background: #e2e8f0; border-radius: 6px; }
.cons-ph { display: grid; place-items: center; font-size: 11px; color: #64748b; }
.cons-fecha { font-size: 11px; color: #64748b; }
.cons-aviso { margin: 0; font-size: 12px; color: #15803d; }
</style>
