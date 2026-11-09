<template>
  <!-- Próximos controles de los pacientes (PAPER §33): cuándo vuelve cada uno y qué hay
       que hacer, para que el cambio de internos no pierda nada. Sale del control de la
       consulta más reciente de cada paciente. -->
  <section class="ctl">
    <header class="ctl-head">
      <h2>Controles</h2>
      <input v-model="q" class="ctl-buscar" type="search" placeholder="Paciente o cédula" aria-label="Buscar paciente" />
      <button type="button" class="ctl-recargar" :disabled="cargando" :title="cargando ? 'Cargando…' : 'Volver a cargar'" @click="cargar">↻</button>
    </header>

    <p v-if="error" class="ctl-error">{{ error }} <button type="button" class="ctl-link" @click="cargar">Reintentar</button></p>
    <p v-else-if="cargando && !filas.length" class="ctl-estado">Cargando controles…</p>
    <p v-else-if="!visibles.length" class="ctl-estado">
      {{ q.trim() ? `Ningún control para «${q.trim()}»` : 'No hay controles agendados en los próximos 90 días' }}
    </p>

    <div v-else class="ctl-grupos">
      <section v-for="g in grupos" :key="g.clave" class="ctl-grupo" :data-grupo="g.clave">
        <h3 class="ctl-titulo" :class="{ 'ctl-titulo-atrasado': g.clave === 'atrasados' }">{{ g.titulo }} <span class="ctl-n">{{ g.filas.length }}</span></h3>
        <button v-for="c in g.filas" :key="c.episode_id" type="button" class="ctl-fila"
                :class="`ctl-${c.estado_control}`" :disabled="!c.patient_id"
                :title="c.patient_id ? 'Abrir la ficha del paciente' : 'El paciente ya no está disponible'"
                @click="abrir(c)">
          <span class="ctl-fecha">
            <strong>{{ diaSemana(c.fecha_control) }}</strong>
            <span>{{ fechaLarga(c.fecha_control) }}</span>
            <span v-if="c.estado_control === 'atrasado'" class="ctl-chip ctl-chip-rojo">Atrasado</span>
            <span v-else-if="c.estado_control === 'hoy'" class="ctl-chip">Hoy</span>
          </span>
          <span class="ctl-cuerpo">
            <span class="ctl-paciente">{{ c.paciente || 'Paciente sin nombre' }}<span v-if="c.cedula" class="ctl-cedula"> · {{ c.cedula }}</span></span>
            <span class="ctl-motivo">{{ c.motivo || 'Sin indicación de qué hacer' }}</span>
            <span v-if="c.plan" class="ctl-plan">Plan: {{ c.plan }}</span>
            <span class="ctl-meta">{{ [c.diagnostico, c.medico && `indicó ${c.medico}`, c.fecha_consulta && `consulta del ${fechaLarga(c.fecha_consulta)}`].filter(Boolean).join(' · ') }}</span>
          </span>
        </button>
      </section>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { listarControles } from '../api.js';

defineProps({ user: { type: Object, default: null } });
const router = useRouter();

const filas = ref([]);
const hoy = ref('');
const q = ref('');
const cargando = ref(false);
const error = ref('');

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fecha = (iso) => new Date(`${iso}T00:00:00Z`);
const diaSemana = (iso) => DIAS[fecha(iso).getUTCDay()];
function fechaLarga(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${y}`;
}
function sumarDias(iso, n) {
  const d = fecha(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function lunesDe(iso) {
  const dia = fecha(iso).getUTCDay();
  return sumarDias(iso, dia === 0 ? -6 : 1 - dia);
}

const visibles = computed(() => {
  const t = q.value.trim().toLowerCase();
  if (!t) return filas.value;
  return filas.value.filter((c) => `${c.paciente || ''} ${c.cedula || ''}`.toLowerCase().includes(t));
});

/** Atrasados arriba; después, una sección por semana (lunes a domingo). */
const grupos = computed(() => {
  const out = [];
  const atrasados = visibles.value.filter((c) => c.estado_control === 'atrasado');
  if (atrasados.length) out.push({ clave: 'atrasados', titulo: 'Atrasados', filas: atrasados });
  const esta = hoy.value ? lunesDe(hoy.value) : '';
  const porSemana = new Map();
  for (const c of visibles.value) {
    if (c.estado_control === 'atrasado') continue;
    const l = lunesDe(c.fecha_control);
    if (!porSemana.has(l)) porSemana.set(l, []);
    porSemana.get(l).push(c);
  }
  for (const [l, fs] of porSemana) {
    const titulo = l === esta ? 'Esta semana'
      : l === sumarDias(esta, 7) ? 'Próxima semana'
        : `Semana del ${fechaLarga(l)}`;
    out.push({ clave: l, titulo, filas: fs });
  }
  return out;
});

function abrir(c) {
  if (!c.patient_id) return;
  router.push({ name: 'chat-paciente', params: { patientId: c.patient_id, seccion: 'ficha' } });
}

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const r = await listarControles();
    filas.value = r?.data || [];
    hoy.value = r?.today || '';
  } catch (e) {
    error.value = `No se pudieron cargar los controles: ${e?.message || 'sin conexión'}`;
  } finally {
    cargando.value = false;
  }
}

onMounted(cargar);
</script>

<style scoped>
.ctl { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow-y: auto; }
.ctl-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.ctl-head h2 { margin: 0; font-size: 1.05rem; color: var(--accent); }
.ctl-buscar { flex: 1; min-width: 200px; padding: 8px 12px; font-size: 14px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.ctl-recargar { padding: 6px 10px; font-size: 15px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
.ctl-recargar:disabled { opacity: .5; cursor: not-allowed; }
.ctl-estado { padding: 24px; text-align: center; color: #94a3b8; }
.ctl-error { padding: 8px 14px; color: #b91c1c; }
.ctl-link { font-size: 13px; color: #0369a1; background: none; border: 0; text-decoration: underline; cursor: pointer; }
.ctl-grupos { display: flex; flex-direction: column; gap: 14px; padding: 10px 14px 16px; }
.ctl-grupo { display: flex; flex-direction: column; gap: 6px; }
.ctl-titulo { margin: 0; font-size: 13px; font-weight: 700; color: var(--text); text-transform: uppercase; letter-spacing: .03em; }
.ctl-titulo-atrasado { color: #b91c1c; }
.ctl-n { margin-left: 4px; font-weight: 600; color: #64748b; }
.ctl-fila { display: grid; grid-template-columns: 120px 1fr; gap: 12px; padding: 10px 12px; text-align: left; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
.ctl-fila:hover:not(:disabled) { border-color: var(--accent); }
.ctl-fila:disabled { opacity: .6; cursor: not-allowed; }
.ctl-atrasado { border-left: 4px solid #dc2626; }
.ctl-hoy { border-left: 4px solid var(--accent); }
.ctl-fecha { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.ctl-fecha strong { text-transform: capitalize; }
.ctl-chip { align-self: flex-start; padding: 1px 8px; font-size: 11px; font-weight: 600; color: #fff; background: var(--accent); border-radius: 999px; }
.ctl-chip-rojo { background: #dc2626; }
.ctl-cuerpo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ctl-paciente { font-weight: 600; font-size: 14px; }
.ctl-cedula { font-weight: 400; color: #64748b; }
.ctl-motivo { font-size: 14px; }
.ctl-plan, .ctl-meta { font-size: 12px; color: #64748b; }
@media (max-width: 600px) { .ctl-fila { grid-template-columns: 1fr; } }
</style>
