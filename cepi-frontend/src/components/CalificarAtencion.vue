<template>
  <div class="calificar">
    <header class="c-head">
      <img class="c-logo" src="/images/logo-cepi.png" alt="CEPI Centro de la Piel" />
      <strong class="c-brand">Califica tu atención</strong>
    </header>

    <main class="c-body">
      <!-- 1. Cédula -->
      <form v-if="step === 'cedula'" class="c-card" @submit.prevent="submitCedula">
        <h1>Ingresa tu número de cédula</h1>
        <input
          v-model="cedula" class="c-cedula" inputmode="numeric" autocomplete="off" maxlength="13"
          aria-label="Número de cédula" placeholder="0912345678"
        />
        <button
          type="submit" class="c-primary" :disabled="!cedulaValid || busy"
          :title="cedulaValid ? '' : 'La cédula tiene al menos 6 dígitos'"
        >{{ busy ? 'Buscando…' : 'Continuar' }}</button>
      </form>

      <!-- 2. Calificación -->
      <section v-else-if="step === 'rate'" class="c-card">
        <h1>¿Cómo calificas la atención que recibiste?</h1>
        <div class="c-stars" role="radiogroup" aria-label="Calificación de 1 a 5">
          <button
            v-for="n in 5" :key="n" type="button" class="c-star" role="radio"
            :class="{ on: n <= score }" :aria-checked="score === n" :aria-label="`${n} — ${LABELS[n]}`"
            @click="score = n"
          >★</button>
        </div>
        <p class="c-label">{{ score ? LABELS[score] : 'Toca una estrella' }}</p>
        <div class="c-actions">
          <button type="button" class="c-secondary" :disabled="busy" @click="reset">Volver</button>
          <button
            type="button" class="c-primary" :disabled="!score || busy"
            :title="score ? '' : 'Elige de 1 a 5 estrellas'" @click="submitRating"
          >{{ busy ? 'Enviando…' : 'Enviar' }}</button>
        </div>
      </section>

      <!-- 3. Resultado. Tras calificar no hay "otra vez": la atención ya quedó calificada.
           Los demás resultados dejan corregir la cédula. -->
      <section v-else class="c-card c-result" role="status">
        <div class="c-emoji">{{ RESULTS[step].emoji }}</div>
        <h1>{{ RESULTS[step].title }}</h1>
        <p>{{ RESULTS[step].text }}</p>
        <button
          type="button" class="c-secondary" :disabled="step === 'rated'"
          :title="step === 'rated' ? 'Tu atención ya quedó calificada' : ''" @click="reset"
        >Ingresar otra cédula</button>
      </section>

      <p v-if="error" class="c-error" role="alert">{{ error }}</p>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { lookupCareRating, rateCare } from '../api.js';

const LABELS = { 1: 'Muy mala', 2: 'Mala', 3: 'Regular', 4: 'Buena', 5: 'Excelente' };
const RESULTS = {
  rated: { emoji: '🙏', title: '¡Gracias por tu calificación!', text: 'Tu opinión nos ayuda a mejorar.' },
  already_rated: { emoji: '✅', title: 'Ya calificaste tu atención', text: 'Solo se puede calificar una vez. ¡Gracias!' },
  expired: { emoji: '⌛', title: 'Caducado', text: 'El tiempo para calificar esta atención ya pasó.' },
  no_episode: { emoji: '🔎', title: 'No encontramos tu atención', text: 'Revisa el número o consulta en recepción.' },
};

const step = ref('cedula');
const cedula = ref('');
const score = ref(0);
const busy = ref(false);
const error = ref('');

const digits = computed(() => cedula.value.replace(/\D/g, ''));
const cedulaValid = computed(() => digits.value.length >= 6 && digits.value.length <= 13);

watch(cedula, (v) => { const d = v.replace(/\D/g, '').slice(0, 13); if (d !== v) cedula.value = d; });

function messageFor(e) {
  return e?.status === 429 ? 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' : 'No hay conexión con el servidor. Intenta de nuevo.';
}

async function submitCedula() {
  if (!cedulaValid.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const r = await lookupCareRating(digits.value);
    step.value = r.status === 'can_rate' ? 'rate' : r.status;
  } catch (e) { error.value = messageFor(e); }
  finally { busy.value = false; }
}

async function submitRating() {
  if (!score.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const r = await rateCare(digits.value, score.value);
    step.value = r.status === 'can_rate' ? 'rate' : r.status;
  } catch (e) { error.value = messageFor(e); }
  finally { busy.value = false; }
}

function reset() {
  step.value = 'cedula'; cedula.value = ''; score.value = 0; error.value = '';
}
</script>

<style scoped>
.calificar {
  min-height: 100dvh; width: 100%;
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
}
.c-head {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: var(--accent-band, var(--accent)); color: #fff;
}
.c-logo { height: 40px; }
.c-brand { font-size: 1.1rem; }
.c-body {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 24px 16px; gap: 12px;
}
.c-card {
  width: 100%; max-width: 440px;
  display: flex; flex-direction: column; align-items: stretch; gap: 16px; text-align: center;
}
.c-card h1 { margin: 0; font-size: 1.45rem; color: var(--accent); }
.c-cedula {
  font-size: 1.7rem; text-align: center; letter-spacing: 0.12em; padding: 12px;
  border: 2px solid var(--border); border-radius: 12px; background: transparent; color: var(--text);
}
.c-primary, .c-secondary {
  font-size: 1.15rem; padding: 14px 20px; border-radius: 12px; border: none; cursor: pointer;
}
.c-primary { background: var(--accent); color: #fff; }
.c-secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
.c-primary:disabled, .c-secondary:disabled { opacity: 0.45; cursor: not-allowed; }
.c-actions { display: grid; grid-template-columns: 1fr 2fr; gap: 12px; }
.c-stars { display: flex; justify-content: center; gap: 2px; }
.c-star {
  font-size: clamp(2.6rem, 15vw, 3.6rem); line-height: 1; padding: 4px;
  background: none; border: none; cursor: pointer; color: var(--border);
}
.c-star.on { color: #f5a623; }
.c-label { margin: 0; font-size: 1.25rem; min-height: 1.5em; color: var(--text-muted); }
.c-result p { margin: 0; font-size: 1.1rem; color: var(--text-muted); }
.c-emoji { font-size: 56px; line-height: 1; }
.c-error { color: #c62828; margin: 0; }
</style>
