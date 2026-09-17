<template>
  <div class="casos-lista">
    <header class="cl-filtros">
      <input v-model.trim="q" class="cl-input" type="search" placeholder="Buscar por diagnóstico…" @keyup.enter="buscar" />
      <div class="cl-fila">
        <input v-model.trim="cie10" class="cl-input cl-corto" placeholder="CIE-10" @keyup.enter="buscar" />
        <select v-model="estado" class="cl-input cl-corto">
          <option value="">Todo estado</option>
          <option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option>
        </select>
      </div>
      <div class="cl-fila">
        <input v-model="desde" class="cl-input" type="date" title="Desde" />
        <input v-model="hasta" class="cl-input" type="date" title="Hasta" />
      </div>
      <div class="cl-fila">
        <select v-model="deuda" class="cl-input" title="Deuda de datos">
          <option value="">Cualquier llenado</option>
          <option value="25">Menos del 25% lleno</option>
          <option value="50">Menos del 50% lleno</option>
          <option value="75">Menos del 75% lleno</option>
        </select>
        <select v-model="orden" class="cl-input" title="Orden">
          <option value="-fecha">Más recientes</option>
          <option value="ficha_completitud">Más incompletos</option>
          <option value="-ficha_completitud">Más completos</option>
        </select>
      </div>
      <div class="cl-fila">
        <select v-model="origen" class="cl-input">
          <option value="">Todo origen</option>
          <option value="drpro">Importados de DrPro</option>
          <option value="cepi">Capturados en CEPI</option>
        </select>
        <button class="cl-btn" :disabled="cargando" @click="buscar()">Buscar</button>
      </div>
    </header>

    <p v-if="error" class="cl-estado cl-error">{{ error }}</p>
    <p v-else-if="cargando" class="cl-estado">Buscando…</p>
    <p v-else-if="!casos.length" class="cl-estado">Ningún episodio con esos criterios.</p>

    <p v-if="!cargando && casos.length" class="cl-cuenta">
      {{ casos.length }}{{ hayMas ? '+' : '' }} episodios
    </p>

    <ul class="cl-items">
      <li
        v-for="c in casos" :key="c.id"
        class="cl-item" :class="{ 'cl-item--sel': c.id === activeId }"
        @click="$emit('select', { episodeId: c.id, patientId: c.patient_id })"
      >
        <div class="cl-item-top">
          <span class="cl-fecha">{{ fecha(c.fecha) }}</span>
          <span v-if="c.drpro_cita_id" class="cl-tag cl-tag--drpro">DrPro</span>
          <span class="cl-tag">{{ c.estado }}</span>
          <span
            v-if="c.ficha_completitud !== null && c.ficha_completitud !== undefined"
            class="cl-pct" :class="pctClase(c.ficha_completitud)"
            :title="c.ficha_faltantes ? 'Falta: ' + c.ficha_faltantes : 'Ficha completa'"
          >{{ c.ficha_completitud }}%</span>
          <span v-else class="cl-pct cl-pct--nc" title="Nunca se calculó la completitud de esta ficha">s/c</span>
        </div>
        <div class="cl-paciente">{{ nombres[c.patient_id] || '—' }}</div>
        <div class="cl-dx">
          <span v-if="c.codigo_cie10" class="cl-cie">{{ c.codigo_cie10 }}</span>
          {{ resumen(c) }}
        </div>
        <div v-if="c.ficha_faltantes" class="cl-falta">Falta: {{ c.ficha_faltantes }}</div>
      </li>
    </ul>

    <button
      v-if="casos.length" class="cl-mas" :disabled="!hayMas || cargando"
      :title="hayMas ? 'Cargar los siguientes resultados' : 'Ya se listaron todos los episodios'"
      @click="buscar(true)"
    >{{ cargando ? 'Buscando…' : (hayMas ? 'Ver más' : 'No hay más resultados') }}</button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listarCasos, listarPacientes } from '../api.js';

defineProps({ activeId: { type: String, default: null } });
defineEmits(['select']);

const ESTADOS = ['agendado', 'en_curso', 'cerrado', 'enviada', 'en_triage', 'respondida', 'derivada'];
const PAGINA = 40;

const q = ref(''); const cie10 = ref(''); const estado = ref('');
const desde = ref(''); const hasta = ref(''); const origen = ref('');
const deuda = ref(''); const orden = ref('-fecha');
const casos = ref([]); const nombres = ref({});
const cargando = ref(false); const error = ref(''); const hayMas = ref(false);

const fecha = (f) => (f ? String(f).slice(0, 10) : '—');

/** Verde/ámbar/rojo por tramos: el color es un atajo, el número sigue estando. */
function pctClase(p) {
  const n = Number(p);
  if (n >= 75) return 'cl-pct--alto';
  if (n >= 40) return 'cl-pct--medio';
  return 'cl-pct--bajo';
}

/** Una línea legible del caso: el diagnóstico si lo hay, si no el motivo. */
function resumen(c) {
  return c.diagnostico || c.motivo_consulta || c.tipo_cita || 'Sin diagnóstico registrado';
}

/**
 * `masResultados` se pasa EXPLÍCITAMENTE, nunca desde un `@click="buscar"`: Vue
 * entrega el MouseEvent como primer argumento y, siendo truthy, el botón «Buscar»
 * terminaba paginando en vez de reiniciar la búsqueda — la lista conservaba los
 * resultados viejos y el filtro nuevo parecía no aplicar.
 */
async function buscar(masResultados = false) {
  cargando.value = true; error.value = '';
  const offset = masResultados ? casos.value.length : 0;
  try {
    const r = await listarCasos({
      q: q.value, codigo_cie10: cie10.value, estado: estado.value,
      desde: desde.value, hasta: hasta.value, origen: origen.value,
      deuda: deuda.value, orden: orden.value,
      limit: PAGINA, offset,
    });
    const filas = r.data || [];
    casos.value = masResultados ? [...casos.value, ...filas] : filas;
    hayMas.value = filas.length === PAGINA;
    await cargarNombres(casos.value);
  } catch (e) {
    error.value = e?.message || 'No se pudo buscar';
    if (!masResultados) casos.value = [];
  } finally {
    cargando.value = false;
  }
}

/**
 * El listado de episodios trae `patient_id` como UUID. Se resuelven los nombres en
 * UNA llamada por lote en vez de una por caso, y solo los que aún no están en caché.
 */
async function cargarNombres(filas) {
  const faltan = [...new Set(filas.map(c => c.patient_id).filter(id => id && !nombres.value[id]))];
  if (!faltan.length) return;
  try {
    const r = await listarPacientes({ ids: faltan });
    for (const p of r.data || []) {
      nombres.value[p.id] = [p.nombre, p.apellidos].filter(Boolean).join(' ').trim() || p.cedula || '—';
    }
  } catch { /* la lista sirve igual sin los nombres */ }
}

onMounted(buscar);
defineExpose({ buscar });
</script>

<style scoped>
.casos-lista { display: flex; flex-direction: column; height: 100%; overflow-y: auto; }
.cl-filtros { position: sticky; top: 0; z-index: 2; display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--cepi-bg, #fff); border-bottom: 1px solid #e2e8f0; }
.cl-fila { display: flex; gap: 6px; }
.cl-input { flex: 1; min-width: 0; padding: 7px 9px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; }
.cl-corto { flex: 1; }
.cl-btn { padding: 7px 14px; font-size: 13px; font-weight: 600; color: #fff; background: #0ea5e9; border: 0; border-radius: 6px; cursor: pointer; }
.cl-btn:disabled { opacity: .55; cursor: default; }

.cl-estado { padding: 16px 12px; margin: 0; font-size: 13px; color: #64748b; }
.cl-error { color: #b91c1c; }
.cl-cuenta { padding: 8px 12px 2px; margin: 0; font-size: 12px; color: #94a3b8; }

.cl-items { list-style: none; margin: 0; padding: 0; }
.cl-item { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
.cl-item:hover { background: #f8fafc; }
.cl-item--sel { background: #e0f2fe; }
.cl-item-top { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.cl-fecha { font-size: 12px; color: #64748b; }
.cl-tag { padding: 1px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #475569; background: #f1f5f9; border-radius: 999px; }
.cl-tag--drpro { color: #7c2d12; background: #ffedd5; }
.cl-paciente { font-size: 14px; font-weight: 600; color: #0f172a; }
.cl-dx { font-size: 13px; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cl-cie { margin-right: 5px; padding: 0 5px; font-size: 11px; font-weight: 700; color: #0369a1; background: #e0f2fe; border-radius: 4px; }
.cl-pct { margin-left: auto; padding: 1px 6px; font-size: 11px; font-weight: 700; border-radius: 999px; }
.cl-pct--alto  { color: #14532d; background: #dcfce7; }
.cl-pct--medio { color: #78350f; background: #fef3c7; }
.cl-pct--bajo  { color: #7f1d1d; background: #fee2e2; }
/* "s/c" = sin calcular. No es 0%: distinguirlo evita leer como ficha vacía una que
   nadie evaluó todavía. */
.cl-pct--nc { color: #475569; background: #f1f5f9; }
.cl-falta { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cl-mas { margin: 10px auto 20px; padding: 7px 16px; font-size: 13px; color: #0369a1; background: none; border: 1px solid #bae6fd; border-radius: 6px; cursor: pointer; }
/* Deshabilitado en vez de oculto: que desaparezca no dice si la lista se acabó
   o si el botón se rompió. Ver la regla en CLAUDE.md. */
.cl-mas:disabled { color: #94a3b8; background: none; border-color: #e2e8f0; cursor: default; }
</style>
