<template>
  <div class="pac-lista">
    <header class="pl-filtros">
      <input v-model.trim="q" class="pl-input" type="search"
             placeholder="Nombre, cédula, ciudad…" @keyup.enter="buscar()" />
      <div class="pl-fila">
        <select v-model="origen" class="pl-input">
          <option value="">Todo origen</option>
          <option value="drpro">Importados de DrPro</option>
          <option value="cepi">Capturados en CEPI</option>
        </select>
        <button class="pl-btn" :disabled="cargando" @click="buscar()">Buscar</button>
      </div>
    </header>

    <p v-if="error" class="pl-estado pl-error">{{ error }}</p>
    <p v-else-if="cargando" class="pl-estado">Buscando…</p>
    <p v-else-if="!pacientes.length" class="pl-estado">Ningún paciente con esos criterios.</p>
    <p v-else class="pl-cuenta">{{ pacientes.length }}{{ hayMas ? '+' : '' }} pacientes</p>

    <ul class="pl-items">
      <li
        v-for="p in pacientes" :key="p.id"
        class="pl-item" :class="{ 'pl-item--sel': p.id === activeId }"
        @click="$emit('select', { patientId: p.id })"
      >
        <div class="pl-top">
          <span class="pl-nombre">{{ nombre(p) }}</span>
          <span v-if="p.drpro_id" class="pl-tag pl-tag--drpro">DrPro</span>
        </div>
        <div class="pl-sub">
          <span v-if="p.cedula" class="pl-ced">{{ p.cedula }}</span>
          {{ [p.sector_ciudad, edad(p)].filter(Boolean).join(' · ') || '—' }}
        </div>
      </li>
    </ul>

    <button
      v-if="pacientes.length" class="pl-mas" :disabled="!hayMas || cargando"
      :title="hayMas ? 'Cargar los siguientes resultados' : 'Ya se listaron todos los pacientes'"
      @click="buscar(true)"
    >{{ cargando ? 'Buscando…' : (hayMas ? 'Ver más' : 'No hay más resultados') }}</button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listarPacientesBusqueda } from '../api.js';

defineProps({ activeId: { type: String, default: null } });
defineEmits(['select']);

const PAGINA = 40;
const q = ref(''); const origen = ref('');
const pacientes = ref([]); const cargando = ref(false); const error = ref(''); const hayMas = ref(false);

const nombre = (p) => [p.nombre, p.apellidos].filter(Boolean).join(' ').trim() || '(sin nombre)';

/** La edad se deriva de la fecha de nacimiento; el campo `edad` de DrPro casi nunca viene. */
function edad(p) {
  if (!p.fecha_nac) return '';
  const n = new Date(p.fecha_nac);
  if (Number.isNaN(n.getTime())) return '';
  const hoy = new Date();
  let a = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) a--;
  return a >= 0 && a < 130 ? `${a} años` : '';
}

/** Igual que en la lista de casos: `masResultados` se pasa EXPLÍCITAMENTE, nunca
 *  desde un `@click="buscar"` — Vue entregaría el MouseEvent y paginaría sin querer. */
async function buscar(masResultados = false) {
  cargando.value = true; error.value = '';
  const offset = masResultados ? pacientes.value.length : 0;
  try {
    const r = await listarPacientesBusqueda({ q: q.value, origen: origen.value, limit: PAGINA, offset });
    const filas = r.data || [];
    pacientes.value = masResultados ? [...pacientes.value, ...filas] : filas;
    hayMas.value = filas.length === PAGINA;
  } catch (e) {
    error.value = e?.message || 'No se pudo buscar';
    if (!masResultados) pacientes.value = [];
  } finally {
    cargando.value = false;
  }
}

onMounted(() => buscar());
defineExpose({ buscar });
</script>

<style scoped>
.pac-lista { display: flex; flex-direction: column; height: 100%; overflow-y: auto; }
.pl-filtros { position: sticky; top: 0; z-index: 2; display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--cepi-bg, #fff); border-bottom: 1px solid #e2e8f0; }
.pl-fila { display: flex; gap: 6px; }
.pl-input { flex: 1; min-width: 0; padding: 7px 9px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; }
.pl-btn { padding: 7px 14px; font-size: 13px; font-weight: 600; color: #fff; background: #0ea5e9; border: 0; border-radius: 6px; cursor: pointer; }
.pl-btn:disabled { opacity: .55; cursor: default; }
.pl-estado { padding: 16px 12px; margin: 0; font-size: 13px; color: #64748b; }
.pl-error { color: #b91c1c; }
.pl-cuenta { padding: 8px 12px 2px; margin: 0; font-size: 12px; color: #94a3b8; }
.pl-items { list-style: none; margin: 0; padding: 0; }
.pl-item { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
.pl-item:hover { background: #f8fafc; }
.pl-item--sel { background: #e0f2fe; }
.pl-top { display: flex; align-items: center; gap: 6px; }
.pl-nombre { font-size: 14px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-tag { padding: 1px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; border-radius: 999px; }
.pl-tag--drpro { color: #7c2d12; background: #ffedd5; }
.pl-sub { font-size: 12px; color: #64748b; }
.pl-ced { margin-right: 6px; padding: 0 5px; font-size: 11px; color: #334155; background: #f1f5f9; border-radius: 4px; }
.pl-mas { margin: 10px auto 20px; padding: 7px 16px; font-size: 13px; color: #0369a1; background: none; border: 1px solid #bae6fd; border-radius: 6px; cursor: pointer; }
/* Deshabilitado en vez de oculto: que desaparezca no dice si la lista se acabó
   o si el botón se rompió. Ver la regla en CLAUDE.md. */
.pl-mas:disabled { color: #94a3b8; background: none; border-color: #e2e8f0; cursor: default; }
</style>
