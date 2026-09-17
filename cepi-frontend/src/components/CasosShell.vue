<template>
  <div class="cshell" :class="`cshell--${panel}`">
    <div class="cshell-lado">
      <!-- Dos pestañas porque la ficha tiene dos niveles: §1-§2 son del PACIENTE y
           los comparten todas sus visitas; §3 en adelante son de LA VISITA. Buscar
           por caso y buscar por persona son preguntas distintas. -->
      <nav class="cshell-tabs" role="tablist">
        <button role="tab" :aria-selected="tab === 'casos'"
                :class="{ on: tab === 'casos' }" @click="tab = 'casos'">Episodios</button>
        <button role="tab" :aria-selected="tab === 'pacientes'"
                :class="{ on: tab === 'pacientes' }" @click="tab = 'pacientes'">Pacientes</button>
      </nav>

      <CasoLista v-show="tab === 'casos'" class="cshell-lista"
                 :active-id="sel.episodeId" @select="(c) => irACaso(c.episodeId)" />
      <PacienteLista v-show="tab === 'pacientes'" class="cshell-lista"
                     :active-id="sel.patientId" @select="(p) => irAPaciente(p.patientId)" />
    </div>

    <div class="cshell-detalle">
      <header v-if="sel.episodeId || sel.patientId" class="cshell-head">
        <button class="cshell-volver" @click="router.push('/casos')" aria-label="Volver a la lista">‹</button>
        <h2 class="cshell-titulo">{{ sel.episodeId ? 'Ficha del episodio' : 'Ficha del paciente' }}</h2>
      </header>

      <!-- Las visitas siguen visibles al entrar en una: comparar dos consultas del
           mismo paciente es el movimiento natural, y esconderlas obligaba a volver
           a la lista de pacientes para cambiar de visita. -->
      <!-- Plegado por defecto: la lista se comía la mitad del alto útil de la
           ficha, que es lo que se viene a leer. Se puede cambiar de episodio
           igual sin desplegarla, con «‹ Anterior / Siguiente ›» de la ficha. -->
      <section v-if="sel.patientId && visitas.length" class="cshell-visitas">
        <h3>
          <button class="cshell-acordeon" :aria-expanded="String(visitasAbiertas)" @click="alternarVisitas">
            <span class="cshell-flecha" :class="{ abierta: visitasAbiertas }">▸</span>
            Episodios
            <span class="cshell-visitas-cuenta">{{ visitas.length }}</span>
          </button>
          <span v-if="cargandoVisitas" class="cshell-visitas-hint"><span class="cshell-spin" />actualizando</span>
          <span v-else-if="!visitasAbiertas && resumenVisita" class="cshell-visitas-hint">{{ resumenVisita }}</span>
          <span v-else-if="visitasAbiertas" class="cshell-visitas-hint">clic para cambiar de ficha</span>
        </h3>
        <!-- Mientras llega la lista nueva se conserva la anterior, atenuada. El
             «Cargando…» de antes SUSTITUÍA a la lista: al saltar entre pacientes
             los episodios desaparecían y volvían, que es el salto que se veía. -->
        <p v-if="cargandoVisitas && !visitas.length" class="cshell-vacio">Cargando…</p>
        <p v-else-if="!cargandoVisitas && !visitas.length" class="cshell-vacio">Sin episodios registrados.</p>
        <ul v-else v-show="visitasAbiertas" :class="{ 'cshell-atenuada': cargandoVisitas }">
          <li v-for="v in visitas" :key="v.id" :class="{ on: v.id === sel.episodeId }"
              @click="irACaso(v.id)">
            <span class="cshell-v-fecha">{{ String(v.fecha || '').slice(0, 10) || '—' }}</span>
            <span class="cshell-v-estado">{{ v.estado }}</span>
            <span v-if="v.codigo_cie10" class="cshell-v-cie">{{ v.codigo_cie10 }}</span>
            <span class="cshell-v-dx">{{ v.diagnostico || v.motivo_consulta || 'Sin diagnóstico' }}</span>
            <span v-if="v.id === sel.episodeId" class="cshell-v-actual">viendo</span>
          </li>
        </ul>
      </section>

      <!-- La misma ficha se lee en varios formatos: el de trabajo (grupos
           editables) y los documentales, que son HTML sueltos maquetados en A4
           y se imprimen a PDF desde el navegador. El selector sale siempre que
           haya algo abierto; los formatos que no aplican se deshabilitan, no
           se esconden (regla de CLAUDE.md). -->
      <div v-if="sel.episodeId || sel.patientId" class="cshell-formatos" role="tablist">
        <button
          v-for="f in FORMATOS" :key="f.id" role="tab"
          :aria-selected="formato === f.id"
          :class="{ on: formato === f.id }"
          :disabled="f.exigeEpisodio && !sel.episodeId"
          :title="f.exigeEpisodio && !sel.episodeId ? 'Necesita un episodio abierto, no solo el paciente' : f.ayuda"
          @click="formato = f.id"
        >{{ f.label }}</button>
      </div>

      <FichaCompleta
        v-if="(sel.episodeId || sel.patientId) && formato === 'grupos'"
        :episode-id="sel.episodeId" :patient-id="sel.patientId" :visitas="visitas"
        :cargando-visitas="cargandoVisitas"
        class="cshell-ficha"
        @navegar="irACaso"
      />
      <VisorFormato
        v-else-if="(sel.episodeId || sel.patientId) && formatoActual"
        :key="formato"
        :src="formatoActual.src" :titulo="formatoActual.titulo"
        :episode-id="sel.episodeId" :patient-id="sel.patientId" :visitas="visitas"
        class="cshell-ficha"
        @guardado="trasGuardar"
      />
      <p v-else-if="ajeno" class="cshell-vacio cshell-ajeno">{{ ajeno }}</p>
      <p v-else-if="sinEpisodios" class="cshell-vacio">Este paciente no tiene episodios registrados todavía.</p>
      <p v-else class="cshell-vacio">Elige {{ tab === 'casos' ? 'un episodio' : 'un paciente' }} de la lista.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CasoLista from './CasoLista.vue';
import PacienteLista from './PacienteLista.vue';
import FichaCompleta from './FichaCompleta.vue';
import VisorFormato from './VisorFormato.vue';
import { listarCasosDePaciente, obtenerEntidad, switchOrgToEpisodio, switchOrgToPaciente } from '../api.js';

defineProps({
  user: Object,
  // Los pasa el router desde /casos/caso/:episodeId y /casos/paciente/:patientId.
  episodeId: { type: String, default: null },
  patientId: { type: String, default: null },
});

const route = useRoute();
const router = useRouter();
const tab = ref('casos');
const sel = ref({ episodeId: null, patientId: null });
const visitas = ref([]);
const cargandoVisitas = ref(false);
const ajeno = ref('');   // registro de una org a la que el usuario no pertenece
const sinEpisodios = ref(false);   // paciente abierto que no tiene ninguna ficha

/**
 * El acordeón de episodios. Se recuerda plegado o desplegado entre sesiones: es
 * una preferencia de espacio, y reabrirlo en cada ficha sería pelearse con quien
 * ya decidió. Si el almacenamiento falla (modo privado), se asume plegado.
 */
const CLAVE_ACORDEON = 'cepi.casos.visitasAbiertas';
const visitasAbiertas = ref(false);
try { visitasAbiertas.value = localStorage.getItem(CLAVE_ACORDEON) === '1'; } catch { /* da igual */ }
function alternarVisitas() {
  visitasAbiertas.value = !visitasAbiertas.value;
  try { localStorage.setItem(CLAVE_ACORDEON, visitasAbiertas.value ? '1' : '0'); } catch { /* da igual */ }
}

/** Plegado, la cabecera dice cuál se está viendo: si no, no se sabría. */
const resumenVisita = computed(() => {
  const v = visitas.value.find(x => x.id === sel.value.episodeId);
  if (!v) return '';
  const fecha = String(v.fecha || '').slice(0, 10);
  return [fecha, v.codigo_cie10, v.estado].filter(Boolean).join(' · ');
});

/**
 * Formatos de lectura de la misma ficha. `grupos` es el del portal (editable);
 * el resto son documentos: HTML sueltos en public/, maquetados en A4, que se
 * rellenan por `fillFicha()` y se imprimen a PDF con el diálogo del navegador.
 * Añadir uno nuevo = un .html en public/ + una línea acá.
 */
const FORMATOS = [
  { id: 'grupos', label: 'Grupos', ayuda: 'Los 27 grupos, editables uno a uno' },
  { id: 'ficha',  label: 'Ficha HCU', src: '/ficha.html', titulo: 'Historia Clínica Dermatológica',
    exigeEpisodio: true, ayuda: 'La ficha de una página, la misma de telemedicina' },
  { id: 'msp002', label: 'MSP 002', src: '/msp-002.html', titulo: 'form.002 — Anamnesis y examen físico',
    exigeEpisodio: true, ayuda: 'Anamnesis y examen físico. Maquetación reconstruida: contrastar con el oficial' },
  { id: 'msp053', label: 'MSP 053', src: '/msp-053.html', titulo: 'form.053 — Referencia y contrarreferencia',
    exigeEpisodio: true, ayuda: 'Referencia y contrarreferencia. Maquetación reconstruida: contrastar con el oficial' },
];
/**
 * El formato elegido se mantiene al cambiar de episodio o de paciente: es una
 * preferencia de lectura, no una propiedad del caso. Si estás revisando MSP 002
 * de un paciente y saltas al siguiente, quieres seguir en MSP 002.
 *
 * Antes había un watcher que lo devolvía a «Grupos» cuando no había episodio.
 * Saltaba de más: al entrar por la pestaña de pacientes la ruta pasa un instante
 * por un estado sin episodio, y ese parpadeo bastaba para perder el formato. No
 * hace falta: los formatos que exigen episodio ya se deshabilitan solos.
 */
const CLAVE_FORMATO = 'cepi.casos.formato';
const formato = ref('grupos');
try {
  const guardado = localStorage.getItem(CLAVE_FORMATO);
  if (guardado && FORMATOS.some(f => f.id === guardado)) formato.value = guardado;
} catch { /* modo privado: se queda en grupos */ }
watch(formato, (f) => { try { localStorage.setItem(CLAVE_FORMATO, f); } catch { /* da igual */ } });

const formatoActual = computed(() => FORMATOS.find(f => f.id === formato.value && f.src) || null);
// En móvil solo cabe un panel; en escritorio se ven los dos y `panel` no se usa.
const panel = ref('lista');
// Evita recargar las visitas al navegar entre hermanas del mismo paciente.
let ultimoPacienteCargado = null;

// ── La URL es el estado ──────────────────────────────────────────────────────
// Abrir un caso NAVEGA; la ruta es la que decide qué se ve. Así el enlace se puede
// compartir, la recarga no pierde el sitio y el atrás del navegador funciona solo.
function irACaso(episodeId) { router.push(`/casos/caso/${episodeId}`); }
function irAPaciente(patientId) { router.push(`/casos/paciente/${patientId}`); }

/** Pinta lo que diga la ruta. Es el único sitio donde se toca `sel`. */
async function aplicarRuta() {
  const ep = route.params.episodeId || null;
  const pa = route.params.patientId || null;

  ajeno.value = '';
  sinEpisodios.value = false;

  if (pa && !ep) {
    tab.value = 'pacientes';
    if (!(await asegurarOrg(pa, switchOrgToPaciente))) return;
    sel.value = { episodeId: null, patientId: pa };
    panel.value = 'detalle';
    if (pa !== ultimoPacienteCargado) await cargarVisitas(pa);
    // Buscar por paciente y buscar por episodio abren LO MISMO: la ficha del
    // episodio más reciente. Lo único que cambia entre las dos pestañas es por
    // qué se busca, no qué se ve. Antes la pestaña de pacientes abría una ficha
    // agregada distinta, sin episodio, y ahí ni la navegación entre visitas ni
    // los formatos documentales tenían sentido.
    if (visitas.value.length) {
      router.replace(`/casos/caso/${visitas.value[0].id}`);
      return;
    }
    // Sin episodios no hay ficha que abrir. Tampoco se pinta la del paciente:
    // la URL siempre lleva a una ficha de episodio, nunca a una vista de
    // paciente, para que no existan dos contenidos distintos según la pestaña.
    // Los datos del paciente (§1-§2) se ven y se editan dentro de CUALQUIER
    // episodio suyo, así que no se pierde nada salvo en este caso degenerado.
    sel.value = { episodeId: null, patientId: null };
    sinEpisodios.value = true;
    return;
  }
  if (ep) {
    // Un episodio necesita saber de quién es: sin el paciente no hay episodios
    // hermanos que listar ni contra qué comparar.
    let dueño = sel.value.patientId;
    // Si el episodio ya está en la lista cargada, su paciente se sabe sin pedirlo:
    // moverse con ‹ › entre visitas hermanas no debe costar una consulta por paso.
    const enLista = visitas.value.find(v => v.id === ep);
    if (enLista?.patient_id) dueño = enLista.patient_id;
    else if (!dueño || sel.value.episodeId !== ep) {
      try { dueño = (await obtenerEntidad(ep))?.patient_id || null; } catch { dueño = null; }
      if (!dueño && !(await asegurarOrg(ep, switchOrgToEpisodio))) return;
      if (!dueño) { try { dueño = (await obtenerEntidad(ep))?.patient_id || null; } catch { dueño = null; } }
    }
    sel.value = { episodeId: ep, patientId: dueño };
    panel.value = 'detalle';
    if (dueño && dueño !== ultimoPacienteCargado) await cargarVisitas(dueño);
    return;
  }
  sel.value = { episodeId: null, patientId: null };
  visitas.value = [];
  panel.value = 'lista';
}

/**
 * Un enlace no dice en qué organización vive el dato, y las entidades scoped solo se
 * leen desde la org activa: abrirlo desde otra org daba 404 y una pantalla vacía.
 *
 * Esto NO cruza el límite entre organizaciones. El servidor valida la membresía: si
 * el usuario pertenece a la org del registro se le reemite el token y se recarga —
 * el enlace "cambia de organización"—, y si no, responde 403 y acá se dice en claro
 * que el registro es de otra org. Lo que nunca pasa es enseñar el dato sin cambiar.
 *
 * Devuelve false cuando la ruta no debe pintarse (se está recargando, o es ajeno).
 */
async function asegurarOrg(recordId, cambiar) {
  const r = await cambiar(recordId);
  if (r === 'cambiada') {
    // Recarga entera y no un refetch: la org activa afecta al topbar y a las dos
    // listas, no solo a este panel. La ruta va en el hash, así que se vuelve acá.
    window.location.reload();
    return false;
  }
  if (r === 'ajena') {
    ajeno.value = 'Este registro pertenece a otra organización y tu cuenta no es miembro de ella.';
    panel.value = 'detalle';
    sel.value = { episodeId: null, patientId: null };
    visitas.value = [];
    return false;
  }
  return true;   // 'igual' (misma org) o 'error' → seguir con el camino normal
}

/**
 * La lista NO se vacía antes de pedir la nueva: al saltar de un caso a otro de
 * distinto paciente, vaciarla hacía desaparecer y reaparecer los episodios, y de
 * paso la barra de la ficha se quedaba un instante en «no se pudieron listar los
 * otros episodios», que es un mensaje de error apareciendo en una operación
 * normal. Se sustituye de golpe cuando llega la respuesta.
 *
 * `peticionVisitas` descarta las respuestas que llegan tarde: sin esto, hacer
 * clic rápido en dos pacientes podía dejar en pantalla la lista del primero.
 */
let peticionVisitas = 0;
/**
 * Tras guardar desde un formato documental se recarga la lista: el % de llenado
 * y el diagnóstico del episodio salen en ella, y dejarla como estaba mostraría
 * los valores de antes de guardar.
 */
async function trasGuardar() {
  if (sel.value.patientId) await cargarVisitas(sel.value.patientId);
}

async function cargarVisitas(patientId) {
  ultimoPacienteCargado = patientId;
  const mia = ++peticionVisitas;
  cargandoVisitas.value = true;
  try {
    const filas = (await listarCasosDePaciente(patientId)).data || [];
    if (mia === peticionVisitas) visitas.value = filas;
  } catch {
    if (mia === peticionVisitas) visitas.value = [];
  } finally {
    if (mia === peticionVisitas) cargandoVisitas.value = false;
  }
}


watch(() => route.fullPath, aplicarRuta);
onMounted(aplicarRuta);
</script>

<style scoped>
.cshell { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; height: 100%; min-height: 0; }
.cshell-lado { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #e2e8f0; }
.cshell-lista { flex: 1; min-height: 0; }
.cshell-detalle { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.cshell-ficha { flex: 1; min-height: 0; }
.cshell-vacio { margin: auto; padding: 24px; font-size: 14px; color: #94a3b8; text-align: center; }

.cshell-tabs { display: flex; flex-shrink: 0; border-bottom: 1px solid #e2e8f0; }
.cshell-tabs button {
  flex: 1; padding: 9px 8px; font-size: 13px; font-weight: 600; color: #64748b;
  background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer;
}
.cshell-tabs button.on { color: #0369a1; border-bottom-color: #0ea5e9; }

.cshell-formatos { display: flex; gap: 6px; padding: 8px 14px 0; }
.cshell-formatos button { padding: 5px 12px; font-size: 12px; font-weight: 600; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; cursor: pointer; }
.cshell-formatos button:hover:not(:disabled) { background: #e2e8f0; }
.cshell-formatos button.on { color: #fff; background: #0ea5e9; border-color: #0ea5e9; }
.cshell-formatos button:disabled { color: #cbd5e1; background: #f8fafc; cursor: default; }
.cshell-ajeno { color: #b91c1c; }
.cshell-visitas { padding: 12px 14px 0; }
.cshell-visitas h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
.cshell-acordeon { display: flex; align-items: center; gap: 6px; padding: 2px 0; font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.cshell-flecha { display: inline-block; font-size: 11px; transition: transform .15s; }
.cshell-flecha.abierta { transform: rotate(90deg); }
.cshell-visitas-cuenta { padding: 0 6px; font-size: 11px; color: #0369a1; background: #e0f2fe; border-radius: 999px; }
.cshell-atenuada { opacity: .5; pointer-events: none; }
.cshell-spin { display: inline-block; width: 9px; height: 9px; margin-right: 5px; vertical-align: -1px; border: 2px solid #cbd5e1; border-top-color: #0369a1; border-radius: 50%; animation: cshell-giro .7s linear infinite; }
@keyframes cshell-giro { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cshell-spin { animation-duration: 2.4s; } }
@media (prefers-reduced-motion: reduce) { .cshell-flecha { transition: none; } }
.cshell-visitas ul { list-style: none; margin: 0 0 14px; padding: 0; }
.cshell-visitas li { display: flex; align-items: center; gap: 8px; padding: 7px 10px; margin-bottom: 5px; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 7px; cursor: pointer; }
.cshell-visitas li:hover { background: #f8fafc; }
.cshell-visitas li.on { background: #e0f2fe; border-color: #7dd3fc; border-left: 3px solid #0284c7; }
/* Sin esto la lista se leía como una tabla de solo lectura y nadie la clicaba. */
.cshell-visitas-hint { margin-left: 8px; font-size: 11px; font-weight: 500; text-transform: none; letter-spacing: 0; color: #94a3b8; }
.cshell-v-actual { flex-shrink: 0; padding: 1px 7px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #075985; background: #bae6fd; border-radius: 999px; }
.cshell-v-fecha { color: #64748b; font-size: 12px; }
.cshell-v-estado { padding: 1px 6px; font-size: 10px; text-transform: uppercase; color: #475569; background: #f1f5f9; border-radius: 999px; }
.cshell-v-cie { padding: 0 5px; font-size: 11px; font-weight: 700; color: #0369a1; background: #e0f2fe; border-radius: 4px; }
.cshell-v-dx { flex: 1; min-width: 0; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cshell-head { display: none; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
.cshell-volver { padding: 2px 10px; font-size: 20px; line-height: 1; color: #0369a1; background: none; border: 0; cursor: pointer; }
.cshell-titulo { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }

@media (max-width: 768px) {
  .cshell { grid-template-columns: 1fr; }
  .cshell-head { display: flex; }
  .cshell--lista .cshell-detalle { display: none; }
  .cshell--detalle .cshell-lado { display: none; }
}
</style>
