<template>
  <!-- Calendario de turnos (PAPER §32): quién es el RESPONSABLE cada semana. El de turno
       recibe los pacientes nuevos y las derivaciones al grupo: revisa la ficha, responde
       al médico que lo ingresó y deriva si no puede resolverlo. -->
  <section class="tur">
    <header class="tur-head">
      <h2>Turnos</h2>
      <select v-model="grupo" class="tur-grupo" aria-label="Grupo" :disabled="!grupos.length">
        <option v-if="!grupos.length" value="">{{ cargandoGrupos ? 'Cargando grupos…' : 'Sin grupos' }}</option>
        <option v-for="g in grupos" :key="g.slug" :value="g.slug">{{ g.name }}</option>
      </select>
      <span class="tur-hoy" data-test="de-turno-hoy">
        Responsable de turno hoy: <strong>{{ deTurnoHoy.length ? deTurnoHoy.join(', ') : 'nadie asignado (avisa a todo el grupo)' }}</strong>
      </span>
    </header>

    <p v-if="error" class="tur-error">{{ error }} <button type="button" class="tur-link" @click="cargar">Reintentar</button></p>
    <p v-else-if="cargando && !semanas.length" class="tur-estado">Cargando turnos…</p>

    <ol v-else class="tur-semanas">
      <li v-for="s in semanas" :key="s.inicio" class="tur-semana" :class="{ 'tur-actual': s.actual }" :data-semana="s.inicio">
        <div class="tur-fechas">
          <span class="tur-rango">{{ rango(s) }}</span>
          <span v-if="s.actual" class="tur-chip">Esta semana</span>
        </div>
        <div class="tur-personas">
          <span v-if="!s.turnos.length" class="tur-vacio">Sin asignar</span>
          <span v-for="t in s.turnos" :key="t.id" class="tur-persona">
            {{ t.user_name }}<span v-if="parcial(t, s)" class="tur-parcial"> ({{ diaCorto(t.starts_on) }}–{{ diaCorto(t.ends_on) }})</span>
            <button v-if="puedeEditar" type="button" class="tur-quitar" :disabled="ocupado"
                    :title="ocupado ? 'Espera a que termine el cambio anterior' : `Quitar a ${t.user_name} de este turno`"
                    :aria-label="`Quitar a ${t.user_name}`" @click="quitar(t)">✕</button>
          </span>
        </div>
        <div v-if="puedeEditar" class="tur-asignar">
          <select v-model="eleccion[s.inicio]" :aria-label="`Asignar semana del ${rango(s)}`"
                  :disabled="ocupado || !miembrosLibres(s).length"
                  :title="!miembrosLibres(s).length ? 'Todos los miembros del grupo ya están en esta semana' : ''">
            <option value="">{{ miembrosLibres(s).length ? 'Elegir…' : 'Sin miembros libres' }}</option>
            <option v-for="m in miembrosLibres(s)" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
          <button type="button" class="tur-btn" :disabled="ocupado || !eleccion[s.inicio]"
                  :title="!eleccion[s.inicio] ? 'Elige a quién asignar' : ''" @click="asignar(s)">Asignar</button>
        </div>
      </li>
    </ol>
    <p v-if="aviso" class="tur-aviso" :class="{ 'tur-error': avisoError }">{{ aviso }}</p>
  </section>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { listGroups, listGroupMembers, listarTurnos, asignarTurno, quitarTurno } from '../api.js';

const props = defineProps({ user: { type: Object, default: null } });

const SEMANAS = 8;
const GRUPO_POR_DEFECTO = 'dermatologia';

const grupos = ref([]);
const grupo = ref('');
const cargandoGrupos = ref(false);
const miembros = ref([]);
const turnos = ref([]);
const hoy = ref('');
const cargando = ref(false);
const ocupado = ref(false);
const error = ref('');
const aviso = ref('');
const avisoError = ref(false);
const eleccion = reactive({});

const puedeEditar = computed(() => {
  const p = props.user?.permissions || [];
  return p.includes('groups:manage_shifts') || p.includes('*:*:*:*');
});

// ── fechas (YYYY-MM-DD, sin horas: la semana es de lunes a domingo) ──────────
function sumarDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function lunesDe(iso) {
  const dia = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(iso, dia === 0 ? -6 : 1 - dia);
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function diaCorto(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]}`;
}
/** Fecha local del dispositivo; toISOString() es UTC y en Ecuador después de las 19:00 ya es mañana. */
function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const rango = (s) => `${diaCorto(s.inicio)} – ${diaCorto(s.fin)}`;
const parcial = (t, s) => t.starts_on > s.inicio || t.ends_on < s.fin;

const primerLunes = computed(() => lunesDe(hoy.value || hoyLocal()));

const semanas = computed(() => {
  if (!hoy.value) return [];
  return Array.from({ length: SEMANAS }, (_, i) => {
    const inicio = sumarDias(primerLunes.value, 7 * i);
    const fin = sumarDias(inicio, 6);
    return {
      inicio, fin, actual: i === 0,
      turnos: turnos.value.filter((t) => t.starts_on <= fin && t.ends_on >= inicio),
    };
  });
});

const deTurnoHoy = computed(() => [...new Set(turnos.value
  .filter((t) => hoy.value && t.starts_on <= hoy.value && t.ends_on >= hoy.value)
  .map((t) => t.user_name))]);

function miembrosLibres(s) {
  const ya = new Set(s.turnos.map((t) => t.user_id));
  return miembros.value.filter((m) => !ya.has(m.id));
}

// ── carga ─────────────────────────────────────────────────────────────────────
async function cargarGrupos() {
  cargandoGrupos.value = true;
  try {
    const r = await listGroups();
    // El virtual «Todos» no tiene turnos: no se ofrece.
    grupos.value = (r?.data || []).filter((g) => g.kind !== 'all');
    const def = grupos.value.find((g) => g.slug === GRUPO_POR_DEFECTO) || grupos.value[0];
    grupo.value = def?.slug || '';
  } catch (e) {
    error.value = `No se pudieron cargar los grupos: ${e?.message || 'sin conexión'}`;
  } finally {
    cargandoGrupos.value = false;
  }
}

async function cargar() {
  if (!grupo.value) return;
  cargando.value = true;
  error.value = '';
  try {
    const desde = lunesDe(hoy.value || hoyLocal());
    const [t, m] = await Promise.all([
      listarTurnos(grupo.value, { from: desde, to: sumarDias(desde, 7 * SEMANAS - 1) }),
      listGroupMembers(grupo.value),
    ]);
    // «Hoy» lo manda el servidor (zona horaria de los turnos). Si cae en otra semana que
    // la del dispositivo, se vuelve a pedir el rango correcto.
    const hoyServidor = t?.today || hoy.value || hoyLocal();
    const otraSemana = lunesDe(hoyServidor) !== desde;
    hoy.value = hoyServidor;
    if (otraSemana) { await cargar(); return; }
    turnos.value = t?.data || [];
    miembros.value = (m?.data || []).map((x) => ({ id: x.user_id || x.id, name: x.name || x.user_name || x.email }));
  } catch (e) {
    error.value = `No se pudieron cargar los turnos: ${e?.message || 'sin conexión'}`;
  } finally {
    cargando.value = false;
  }
}

async function cambiar(fn, okMsg) {
  ocupado.value = true;
  aviso.value = '';
  avisoError.value = false;
  try {
    await fn();
    aviso.value = okMsg;
    await cargar();
  } catch (e) {
    avisoError.value = true;
    aviso.value = `No se pudo guardar: ${e?.message || 'error'}`;
  } finally {
    ocupado.value = false;
  }
}

function asignar(s) {
  const userId = eleccion[s.inicio];
  const nombre = miembros.value.find((m) => m.id === userId)?.name || '';
  return cambiar(async () => {
    await asignarTurno(grupo.value, { userId, startsOn: s.inicio, endsOn: s.fin });
    eleccion[s.inicio] = '';
  }, `${nombre} quedó de turno la semana del ${rango(s)}`);
}

function quitar(t) {
  return cambiar(() => quitarTurno(grupo.value, t.id), `Se quitó a ${t.user_name} del turno`);
}

// Cada semana arranca con «Elegir…» seleccionado: sin la clave, el select quedaba en blanco.
watch(semanas, (ss) => { for (const s of ss) if (eleccion[s.inicio] === undefined) eleccion[s.inicio] = ''; }, { immediate: true });
watch(grupo, () => { aviso.value = ''; cargar(); });
onMounted(cargarGrupos);
</script>

<style scoped>
.tur { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow-y: auto; }
.tur-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.tur-head h2 { margin: 0; font-size: 1.05rem; color: var(--accent); }
.tur-grupo { padding: 6px 10px; font-size: 14px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.tur-hoy { font-size: 13px; color: var(--muted, #64748b); }
.tur-hoy strong { color: var(--text); }
.tur-estado { padding: 24px; text-align: center; color: #94a3b8; }
.tur-error { padding: 8px 14px; color: #b91c1c; }
.tur-link { font-size: 13px; color: #0369a1; background: none; border: 0; text-decoration: underline; cursor: pointer; }
.tur-semanas { list-style: none; margin: 0; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
.tur-semana { display: grid; grid-template-columns: 150px 1fr auto; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
.tur-actual { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.tur-fechas { display: flex; flex-direction: column; gap: 2px; }
.tur-rango { font-weight: 600; font-size: 14px; color: var(--text); }
.tur-chip { align-self: flex-start; padding: 1px 8px; font-size: 11px; font-weight: 600; color: #fff; background: var(--accent); border-radius: 999px; }
.tur-personas { display: flex; flex-wrap: wrap; gap: 6px; }
.tur-vacio { font-size: 13px; color: #94a3b8; }
.tur-persona { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 999px; }
.tur-parcial { font-size: 11px; color: #64748b; }
.tur-quitar { padding: 0 2px; font-size: 12px; color: #b91c1c; background: none; border: 0; cursor: pointer; }
.tur-quitar:disabled { color: #94a3b8; cursor: not-allowed; }
.tur-asignar { display: flex; gap: 6px; }
.tur-asignar select { padding: 5px 8px; font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
.tur-btn { padding: 5px 12px; font-size: 13px; font-weight: 600; color: #fff; background: #0ea5e9; border: 0; border-radius: 6px; cursor: pointer; }
.tur-btn:disabled { background: #94a3b8; cursor: not-allowed; }
.tur-aviso { padding: 0 14px 12px; font-size: 13px; color: #15803d; }
@media (max-width: 640px) {
  .tur-semana { grid-template-columns: 1fr; }
}
</style>
