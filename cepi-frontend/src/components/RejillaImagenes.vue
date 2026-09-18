<template>
  <!-- Rejilla de imágenes clínicas. La usan la galería de la organización y la sección
       Imágenes del paciente: cambia qué se pide, no cómo se ve (PAPER §24.2.1). -->
  <div class="rej">
    <p v-if="!cargado && !error" class="rej-estado">Cargando imágenes…</p>
    <div v-else-if="error" class="rej-estado rej-error">
      No se pudieron cargar las imágenes: {{ error }}
      <br><button class="rej-btn" @click="recargar">Reintentar</button>
    </div>
    <p v-else-if="!imagenes.length" class="rej-estado">{{ vacio }}</p>

    <div v-else class="rej-grid">
      <button v-for="img in imagenes" :key="img.id" type="button" class="rej-celda" @click="abrir(img)">
        <img v-if="urls[img.attachment_id]" :src="urls[img.attachment_id]" :alt="pie(img)" loading="lazy" />
        <span v-else-if="rotas[img.attachment_id]" class="rej-ph">Imagen no disponible</span>
        <span v-else class="rej-ph">Cargando…</span>
        <span v-if="mostrarPaciente && img.paciente" class="rej-nombre">{{ img.paciente }}</span>
        <span class="rej-pie">{{ pie(img) }}</span>
      </button>
    </div>

    <button v-if="hayMas" class="rej-mas" :disabled="cargando" @click="mas">
      {{ cargando ? 'Cargando…' : 'Ver más' }}
    </button>

    <div v-if="abierta" class="rej-visor" @click="abierta = null">
      <img :src="urls[abierta.attachment_id]" :alt="pie(abierta)" />
      <p>{{ abierta.paciente }} · {{ pie(abierta) }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { galeria, fetchAttachmentObjectUrl } from '../api.js';

const props = defineProps({
  /** Solo las de este paciente; vacío = todas las de la organización activa. */
  patientId: { type: String, default: '' },
  /** Texto del buscador (paciente, cédula, diagnóstico, CIE-10 o fecha). */
  q: { type: String, default: '' },
  vacio: { type: String, default: 'Todavía no hay imágenes' },
  mostrarPaciente: { type: Boolean, default: true },
});

const imagenes = ref([]);
const total = ref(null);
const urls = ref({});
const rotas = ref({});   // el archivo no está o no se pudo bajar
const cargando = ref(false);
const cargado = ref(false);
const error = ref('');
const abierta = ref(null);
let pedido = 0;
let espera = null;

const hayMas = computed(() => total.value != null && imagenes.value.length < total.value);

function pie(img) {
  const fecha = (img.fecha || '').slice(0, 10);
  const detalle = [img.codigo_cie10, img.diagnostico || img.body_region].filter(Boolean).join(' · ');
  return [fecha, detalle].filter(Boolean).join(' · ');
}

function abrir(img) { abierta.value = img; }

/**
 * Las fotos necesitan el token: se bajan con auth y se muestran como blob. De a tandas,
 * no una por una: en serie, una página de 60 tardaba en llenarse.
 */
async function cargarMiniaturas(filas) {
  const pendientes = filas.filter((f) => !urls.value[f.attachment_id] && !rotas.value[f.attachment_id]);
  const A_LA_VEZ = 6;
  for (let i = 0; i < pendientes.length; i += A_LA_VEZ) {
    await Promise.all(pendientes.slice(i, i + A_LA_VEZ).map(async (img) => {
      try {
        urls.value[img.attachment_id] = await fetchAttachmentObjectUrl(`/api/attachments/${img.attachment_id}/file`);
      } catch {
        // Una imagen que ya no está en disco no rompe la rejilla: se dice y se sigue.
        rotas.value[img.attachment_id] = true;
      }
    }));
  }
}

async function cargar(desde = 0) {
  const mia = ++pedido;
  cargando.value = true;
  try {
    const r = await galeria({ q: props.q, patientId: props.patientId, offset: desde });
    if (mia !== pedido) return;
    const filas = r?.data || [];
    imagenes.value = desde === 0 ? filas : imagenes.value.concat(filas);
    total.value = r?.total ?? null;
    error.value = '';
    cargado.value = true;
    await cargarMiniaturas(filas);
  } catch (e) {
    if (mia !== pedido) return;
    if (desde === 0) imagenes.value = [];
    error.value = e?.message || 'sin conexión con el servidor';
  } finally {
    if (mia === pedido) cargando.value = false;
  }
}

function recargar() { cargar(0); }
function mas() { cargar(imagenes.value.length); }

// Cada tecla reinicia la espera: se busca cuando el texto se queda quieto.
watch(() => [props.q, props.patientId], () => {
  clearTimeout(espera);
  espera = setTimeout(() => cargar(0), 350);
}, { immediate: true });

onUnmounted(() => {
  clearTimeout(espera);
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url);
});
</script>

<style scoped>
.rej { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding: 10px; }
.rej-estado { margin: auto; padding: 24px; font-size: 14px; color: #94a3b8; text-align: center; }
.rej-error { color: #b91c1c; }
.rej-btn { margin-top: 10px; padding: 6px 14px; font-weight: 600; color: #fff; background: #0ea5e9; border: 0; border-radius: 6px; cursor: pointer; }
.rej-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.rej-celda { display: flex; flex-direction: column; gap: 2px; padding: 0; text-align: left; background: none; border: 0; cursor: pointer; }
.rej-celda img { width: 100%; height: 120px; object-fit: cover; background: #f1f5f9; border-radius: 8px; }
.rej-ph { display: grid; place-items: center; height: 120px; font-size: 12px; color: #94a3b8; background: #f1f5f9; border-radius: 8px; }
.rej-nombre { font-size: 12px; font-weight: 600; color: #0f172a; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rej-pie { font-size: 11px; color: #64748b; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rej-mas { align-self: center; margin: 12px 0; padding: 7px 16px; font-weight: 600; color: #0369a1; background: #e0f2fe; border: 0; border-radius: 999px; cursor: pointer; }
.rej-visor { position: fixed; inset: 0; z-index: 1300; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 20px; background: rgba(0,0,0,.92); cursor: zoom-out; }
.rej-visor img { max-width: 100%; max-height: 80vh; object-fit: contain; }
.rej-visor p { margin: 0; font-size: 13px; color: #e2e8f0; }
</style>
