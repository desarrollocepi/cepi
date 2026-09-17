<template>
  <div class="ficha" ref="raiz" :class="{ 'ficha--cargando': recargando }">
    <!-- Recargar NO vacía la ficha: el uso es comparar dos episodios, y quedarse en
         blanco entre uno y otro perdía la posición del scroll y el hilo de lo que
         se estaba mirando. Solo la PRIMERA carga muestra el cartel; a partir de ahí
         se atenúa el contenido y se pone una barra pegada arriba. -->
    <div v-if="recargando" class="ficha-cargando"><span class="ficha-spin" />Cargando…</div>

    <div v-if="cargando && !grupos.length" class="ficha-estado">Cargando ficha…</div>
    <div v-else-if="error" class="ficha-estado ficha-error">{{ error }}</div>

    <template v-else-if="grupos.length">
      <!-- Cabecera: cuánto de la ficha tiene dato. Es la primera pregunta del
           portal ("¿qué falta?"), así que va arriba y no escondida. -->
      <!-- Que existan fichas anteriores tiene que verse ANTES de leer la actual:
           un dato aislado dice poco si no se sabe que hay con qué compararlo.
           La barra sale SIEMPRE, aunque haya una sola visita. Escondiéndola con
           `visitas.length > 1` desaparecía en el 69% de los casos —los pacientes
           de una sola consulta— y sin decir nada: parecía que la navegación no
           existía en vez de que no hubiera a dónde ir. -->
      <nav v-if="episodeId" class="ficha-nav">
        <button
          class="ficha-nav-btn" :disabled="!hayAnterior" @click="paso(1)"
          :title="hayAnterior ? 'Ver el episodio anterior de este paciente' : 'Es el primer episodio'"
        >‹ Anterior</button>

        <span class="ficha-nav-pos">
          <strong v-if="visitas.length">Episodio {{ visitas.length - idx }} de {{ visitas.length }}</strong>
          <strong v-else>Episodio</strong>
          <span v-if="fechaVisita" class="ficha-nav-fecha">{{ fechaVisita }}</span>
          <em v-if="cargandoVisitas && !visitas.length">buscando los otros episodios…</em>
          <em v-else-if="!visitas.length">no se pudieron listar los otros episodios — revisa la organización activa arriba</em>
          <em v-else-if="visitas.length === 1">único episodio registrado de este paciente</em>
          <em v-else-if="anterior && nCambios" class="ficha-nav-dif">
            {{ nCambios }} {{ nCambios === 1 ? 'campo cambió' : 'campos cambiaron' }} desde el del {{ fechaAnterior }}
          </em>
          <em v-else-if="anterior">sin cambios respecto del {{ fechaAnterior }}</em>
          <em v-else>es el primer episodio del paciente</em>
        </span>

        <button
          class="ficha-nav-btn" :disabled="!haySiguiente" @click="paso(-1)"
          :title="haySiguiente ? 'Ver el episodio siguiente de este paciente' : 'Es el episodio más reciente'"
        >Siguiente ›</button>
      </nav>

      <header class="ficha-head">
        <div class="ficha-progreso">
          <div class="ficha-barra"><div class="ficha-barra-fill" :style="{ width: pct + '%' }" /></div>
          <span class="ficha-pct">{{ completos }} de {{ total }} grupos con dato</span>
        </div>
        <span v-if="avisoGuardado" class="ficha-aviso" :class="{ 'ficha-aviso--error': avisoError }">{{ avisoGuardado }}</span>
        <label class="ficha-toggle">
          <input type="checkbox" v-model="soloFaltantes" />
          <span>Solo lo que falta</span>
        </label>
      </header>

      <section v-for="cat in categorias" :key="cat.nombre" class="ficha-cat">
        <h3 class="ficha-cat-titulo">
          {{ cat.nombre }}
          <span class="ficha-cat-cuenta">{{ cat.completos }}/{{ cat.grupos.length }}</span>
        </h3>

        <article
          v-for="g in cat.visibles" :key="g.id"
          class="ficha-grupo" :class="{ 'ficha-grupo--vacio': !g.done }"
        >
          <h4 class="ficha-grupo-titulo">
            <span class="ficha-marca" :class="g.done ? 'ok' : 'falta'">{{ g.done ? '●' : '○' }}</span>
            {{ g.label }}
            <button
              v-if="editable(g)" class="ficha-editar" type="button"
              @click="editando === g.id ? cancelar() : editar(g)"
            >{{ editando === g.id ? 'Cancelar' : (g.done ? 'Editar' : 'Completar') }}</button>
          </h4>

          <!-- En edición se reusa el MISMO formulario que el chat: mismos campos,
               mismos tipos (CIE-10, mapa corporal), misma validación. -->
          <BotForm
            v-if="editando === g.id && g.form"
            :form="formEditable(g)" :busy="guardando" @submit="guardar($event, g)"
          />
          <template v-else>
            <dl v-if="valores(g).length" class="ficha-campos">
              <template v-for="v in valores(g)" :key="v.key">
                <dt :class="{ 'dt-cambiado': v.cambio }"
                    :title="v.cambio ? 'Valor anterior: ' + textoAnterior(v.cambio.antes) : null">{{ v.label }}</dt>
                <dd>{{ v.texto }}</dd>
              </template>
            </dl>
            <p v-else class="ficha-vacio">Sin dato</p>
          </template>
        </article>

        <p v-if="!cat.visibles.length" class="ficha-cat-vacia">Todo este bloque tiene dato.</p>
      </section>
    </template>

    <div v-else class="ficha-estado">Esta ficha no tiene grupos.</div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { fichaCompleta, guardarGrupoFicha } from '../api.js';
import BotForm from './BotForm.vue';

const props = defineProps({
  episodeId: { type: String, default: null },
  patientId: { type: String, default: null },
  /** Las visitas del paciente, más nuevas primero. Sirven para navegar y comparar. */
  visitas: { type: Array, default: () => [] },
  /** El contenedor está trayendo la lista: no es lo mismo que no haya ninguna. */
  cargandoVisitas: { type: Boolean, default: false },
});
const emit = defineEmits(['navegar']);

const grupos = ref([]);
const completos = ref(0);
const total = ref(0);
const cargando = ref(false);
const error = ref('');
const soloFaltantes = ref(false);
const editando = ref(null);
const guardando = ref(false);
const avisoGuardado = ref('');
const avisoError = ref(false);

// Los grupos de imagen (§4.7, §8) no escriben campos: crean registros clinical_image /
// consent al subir la foto. Editarlos desde acá no tendría dónde guardar.
const GRUPOS_IMAGEN = new Set(['g_4_7', 'g_8']);
const editable = (g) => !GRUPOS_IMAGEN.has(g.id) && Boolean(g.form);

function editar(g) { editando.value = g.id; avisoGuardado.value = ''; }

/**
 * El formulario viene del flujo del chat y trae acciones suyas ("Omitir") que emiten
 * un evento de conversación. Acá no hay conversación que las escuche: dejarlas sería
 * un botón que no hace nada sin decirlo.
 */
function formEditable(g) {
  const { actions, ...resto } = g.form || {};
  return resto;
}
function cancelar() { editando.value = null; }

async function guardar(payload, g) {
  guardando.value = true; avisoGuardado.value = ''; avisoError.value = false;
  try {
    const r = await guardarGrupoFicha({
      groupId: g.id, data: payload.data,
      episodeId: props.episodeId, patientId: props.patientId,
    });
    editando.value = null;
    // Se recarga la ficha entera y no solo el grupo: guardar puede mover campos
    // derivados de otros grupos (gravedad_total, BLINK) y el % de llenado.
    await cargar();
    avisoGuardado.value = r.completitud != null ? `Guardado · ${r.completitud}% de la ficha` : 'Guardado';
  } catch (e) {
    avisoError.value = true;
    avisoGuardado.value = e?.message || 'No se pudo guardar';
  } finally {
    guardando.value = false;
  }
}

const pct = computed(() => (total.value ? Math.round((completos.value / total.value) * 100) : 0));

// ── Navegación entre las visitas del paciente ────────────────────────────────
// `visitas` viene ordenada de más nueva a más vieja, así que la ANTERIOR es la
// siguiente del array. Es la misma convención que el visor de telemedicina.
const idx = computed(() => props.visitas.findIndex(v => v.id === props.episodeId));
const hayAnterior = computed(() => idx.value >= 0 && idx.value < props.visitas.length - 1);
const haySiguiente = computed(() => idx.value > 0);
const anterior = computed(() => (idx.value >= 0 ? props.visitas[idx.value + 1] : null) || null);
function paso(dir) {
  const n = idx.value + dir;
  if (n >= 0 && n < props.visitas.length) emit('navegar', props.visitas[n].id);
}

const soloFecha = (v) => String(v?.fecha || '').slice(0, 10);
const fechaVisita = computed(() => (idx.value >= 0 ? soloFecha(props.visitas[idx.value]) : ''));
const fechaAnterior = computed(() => soloFecha(anterior.value));

/**
 * Cuántos campos difieren de la visita anterior. El rojo por sí solo no se ve: los
 * campos que cambian suelen caer bajo el pliegue (§3 en adelante), así que la ficha
 * parecía idéntica a la anterior. El número va arriba y dice que hay algo que mirar.
 *
 * Cuenta el MISMO conjunto que se pinta —los campos con valor que se renderizan—,
 * para que el número y los rojos de abajo no se contradigan.
 */
const nCambios = computed(() => {
  if (!anterior.value) return 0;
  let n = 0;
  for (const g of grupos.value) for (const v of valores(g)) if (v.cambio) n++;
  return n;
});

/**
 * Campos que NO se comparan entre visitas. Misma lista que el visor de telemedicina:
 * son datos de la propia cita (fecha, estado, médico) o derivados, y marcarlos en rojo
 * diría "esto cambió" de algo que cambia SIEMPRE, tapando lo clínico que sí importa.
 */
const SIN_COMPARAR = new Set(['id', 'fecha', 'medico_id', 'patient_id', 'estado', 'tipo',
  'created_at', 'updated_at', 'ficha_num', 'examinador_nombre', 'gravedad_total', 'location',
  'drpro_cita_id', 'tipo_cita', 'ficha_completitud', 'ficha_faltantes', 'ficha_calculada_at',
  'ficha_grupos_con_dato', 'diagnostico_fuente', 'drpro_raw', 'drpro_raw_hash']);

/** Vacío, falso y ausente son lo mismo al comparar. Igual que en telemedicina. */
const norm = (v) => (v === null || v === undefined || v === false || v === '') ? '' : String(v);

/**
 * ¿Este campo difiere de la visita anterior? Devuelve el valor de entonces.
 *
 * Solo se comparan los grupos DEL EPISODIO. Los de §1-§2 viven en el paciente y los
 * comparten todas sus visitas: contrastarlos contra la fila del episodio anterior
 * —que no tiene esas columnas— daba "cambió" en Dirección, Teléfono, Sexo y demás,
 * en cada ficha. Un rojo que sale siempre no señala nada.
 */
function cambio(key, valorActual, target) {
  if (target !== 'episode') return null;
  if (!anterior.value || SIN_COMPARAR.has(key) || key.includes(':')) return null;
  const antes = anterior.value[key];
  if (norm(valorActual) === norm(antes)) return null;
  return { antes };
}

/** El texto del tooltip, con la misma redacción del visor. */
function textoAnterior(v) {
  if (v === null || v === undefined || v === '' || v === false) return '(vacío)';
  if (v === true) return 'Sí';
  return String(v);
}

/**
 * Los grupos vienen planos y en orden; la categoría (§) los agrupa igual que el riel
 * de telemedicina, para que la ficha se lea con la misma estructura en los dos lados.
 */
const categorias = computed(() => {
  const out = [];
  for (const g of grupos.value) {
    const nombre = g.category || 'Otros';
    let cat = out.find(c => c.nombre === nombre);
    if (!cat) { cat = { nombre, grupos: [], completos: 0 }; out.push(cat); }
    cat.grupos.push(g);
    if (g.done) cat.completos++;
  }
  for (const c of out) c.visibles = soloFaltantes.value ? c.grupos.filter(g => !g.done) : c.grupos;
  return soloFaltantes.value ? out.filter(c => c.visibles.length) : out;
});

/** Pares etiqueta/valor de un grupo, legibles: el form trae el schema y los valores. */
function valores(g) {
  const vals = g.form?.values || {};
  return (g.form?.fields || [])
    .filter(f => f.key && vals[f.key] !== undefined && vals[f.key] !== null && vals[f.key] !== '')
    .map(f => ({ key: f.key, label: f.label || f.key, texto: aTexto(vals[f.key], f), cambio: cambio(f.key, vals[f.key], g.target) }));
}

/** Los valores guardados son strings, booleanos, arrays de región o JSON del body map. */
function aTexto(v, f) {
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? (x?.label ?? x?.value ?? JSON.stringify(x)) : x)).join(', ');
  if (v && typeof v === 'object') return JSON.stringify(v);
  const opt = (f?.options || []).find(o => (typeof o === 'object' ? o.value : o) === v);
  if (opt) return typeof opt === 'object' ? (opt.label ?? opt.value) : opt;
  return String(v);
}

const raiz = ref(null);
/** Hay contenido en pantalla y se está trayendo otro: atenuar, no vaciar. */
const recargando = computed(() => cargando.value && grupos.value.length > 0);

/**
 * El contenedor que realmente scrollea. Puede ser la propia ficha o un ancestro
 * (el panel de detalle), según cuánto mida el contenido; se busca en vez de
 * asumirlo para no restaurar el scroll del elemento equivocado.
 */
function contenedorScroll() {
  let el = raiz.value;
  while (el && el !== document.body) {
    const ov = getComputedStyle(el).overflowY;
    if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

async function cargar() {
  if (!props.episodeId && !props.patientId) { grupos.value = []; return; }
  // Se guarda ANTES de tocar los datos: al reemplazar los grupos el contenedor se
  // encoge un instante y el navegador recorta el scrollTop por su cuenta.
  const cont = contenedorScroll();
  const scroll = cont ? cont.scrollTop : 0;

  cargando.value = true; error.value = '';
  try {
    const r = await fichaCompleta({ episodeId: props.episodeId, patientId: props.patientId });
    grupos.value = r.grupos || [];
    completos.value = r.completos ?? 0;
    total.value = r.total ?? grupos.value.length;
    if (cont && scroll) {
      // Dos tics: en el primero Vue aplica el parche, en el segundo el layout ya
      // tiene la altura definitiva y el scrollTop no se recorta.
      await nextTick(); await nextTick();
      cont.scrollTop = Math.min(scroll, cont.scrollHeight - cont.clientHeight);
    }
  } catch (e) {
    error.value = e?.message || 'No se pudo cargar la ficha';
    grupos.value = [];
  } finally {
    cargando.value = false;
  }
}

watch(() => [props.episodeId, props.patientId], cargar, { immediate: true });
defineExpose({ recargar: cargar });
</script>

<style scoped>
.ficha { padding: 12px 14px 40px; overflow-y: auto; position: relative; }
/* Atenuado y sin clics mientras llega la ficha nueva, pero VISIBLE: se sigue viendo
   dónde estabas. Bloquear el puntero evita editar un grupo del episodio anterior. */
.ficha--cargando > *:not(.ficha-cargando) { opacity: .45; pointer-events: none; }
.ficha-cargando { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; margin: -12px -14px 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; color: #0369a1; background: #e0f2fe; border-bottom: 1px solid #bae6fd; }
.ficha-spin { width: 12px; height: 12px; border: 2px solid #7dd3fc; border-top-color: #0369a1; border-radius: 50%; animation: ficha-giro .7s linear infinite; }
@keyframes ficha-giro { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ficha-spin { animation-duration: 2.4s; } }
.ficha-estado { padding: 24px; color: #64748b; font-size: 14px; }
.ficha-error { color: #b91c1c; }

.ficha-head {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 10px 2px 12px; margin-bottom: 8px;
  background: var(--cepi-bg, #fff); border-bottom: 1px solid #e2e8f0;
}
.ficha-progreso { flex: 1; min-width: 0; }
.ficha-barra { height: 6px; border-radius: 3px; background: #e2e8f0; overflow: hidden; }
.ficha-barra-fill { height: 100%; background: #0ea5e9; transition: width .2s; }
.ficha-pct { display: block; margin-top: 5px; font-size: 12px; color: #64748b; }
.ficha-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #334155; white-space: nowrap; cursor: pointer; }

.ficha-cat { margin-bottom: 22px; }
.ficha-cat-titulo {
  display: flex; align-items: baseline; gap: 8px;
  margin: 0 0 8px; font-size: 13px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .04em; color: #475569;
}
.ficha-cat-cuenta { font-weight: 500; letter-spacing: 0; text-transform: none; color: #94a3b8; }
.ficha-cat-vacia { margin: 0; font-size: 13px; color: #94a3b8; }

.ficha-grupo { padding: 10px 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-radius: 8px; }
/* Un grupo vacío no es un error: puede ser data que el origen nunca tuvo (fichas
   espejadas de DrPro). Se marca sin alarma, en gris, no en rojo. */
.ficha-grupo--vacio { background: #f8fafc; border-style: dashed; }
.ficha-grupo-titulo { display: flex; align-items: center; gap: 7px; margin: 0 0 6px; font-size: 14px; font-weight: 600; color: #0f172a; }
.ficha-marca { font-size: 11px; }
.ficha-marca.ok { color: #0ea5e9; }
.ficha-marca.falta { color: #cbd5e1; }

.ficha-editar { margin-left: auto; padding: 2px 9px; font-size: 12px; color: #0369a1; background: none; border: 1px solid #bae6fd; border-radius: 5px; cursor: pointer; }
.ficha-editar:hover { background: #e0f2fe; }
.ficha-aviso { font-size: 12px; color: #15803d; }
.ficha-aviso--error { color: #b91c1c; }

.ficha-campos { display: grid; grid-template-columns: minmax(120px, 30%) 1fr; gap: 4px 14px; margin: 0; }
.ficha-campos dt { font-size: 12px; color: #64748b; }
/* Mismo rojo y misma negrita que el visor de telemedicina, para que la señal
   signifique lo mismo en los dos sitios. */
.ficha-campos dt.dt-cambiado { color: #c8102e; font-weight: 800; cursor: help; }

/* La versión anterior eran dos chevrones pálidos de 20 px sin etiqueta: nadie
   encontraba cómo pasar de una ficha a otra. Botones con texto, con relleno y
   centrados en su propia barra. */
.ficha-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; padding: 9px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.ficha-nav-btn { flex-shrink: 0; padding: 7px 14px; font-size: 13px; font-weight: 600; color: #fff; background: #0ea5e9; border: 0; border-radius: 6px; cursor: pointer; }
.ficha-nav-btn:hover:not(:disabled) { background: #0284c7; }
.ficha-nav-btn:disabled { color: #94a3b8; background: #e2e8f0; cursor: default; }
.ficha-nav-pos { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; text-align: center; }
.ficha-nav-pos strong { font-size: 13px; font-weight: 700; color: #0f172a; }
.ficha-nav-fecha { font-size: 12px; color: #64748b; }
.ficha-nav-pos em { font-size: 12px; font-style: normal; color: #94a3b8; }
/* En rojo y con el mismo peso que los campos marcados abajo: es la misma señal. */
.ficha-nav-pos em.ficha-nav-dif { font-weight: 700; color: #c8102e; }
.ficha-campos dd { margin: 0; font-size: 14px; color: #0f172a; white-space: pre-wrap; overflow-wrap: anywhere; }
.ficha-vacio { margin: 0; font-size: 13px; color: #94a3b8; font-style: italic; }

@media (max-width: 560px) {
  .ficha-campos { grid-template-columns: 1fr; gap: 1px 0; }
  .ficha-campos dd { margin-bottom: 7px; }
}
</style>
