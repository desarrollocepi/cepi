<template>
  <!-- Borrar la cuenta desde la app (App Store 5.1.1(v), Google Play): el login con
       Google crea cuentas, así que también tienen que poder borrarse acá. Vive en el
       perfil y en la pantalla de cuenta pendiente, que es donde cae una cuenta nueva. -->
  <section class="del">
    <button
      type="button" class="del-btn" :disabled="abierto"
      :title="abierto ? 'Confirma o cancela abajo' : 'Eliminar tu cuenta de forma permanente'"
      @click="abrir"
    >Eliminar cuenta</button>

    <div v-if="abierto" class="del-confirm" role="alertdialog" aria-labelledby="del-titulo" aria-describedby="del-texto">
      <h3 id="del-titulo">¿Eliminar tu cuenta?</h3>
      <div id="del-texto">
        <p>
          Se borran tu email, teléfono y cédula, tu acceso con contraseña o con Google, tus
          organizaciones y las notificaciones en tus dispositivos. No se puede deshacer.
        </p>
        <p>
          Las historias clínicas que registraste <strong>no se borran</strong>: pertenecen al
          paciente y a la institución, y la ley obliga a conservarlas. Por eso en ellas sigue tu
          nombre como profesional que atendió.
        </p>
      </div>
      <p v-if="error" class="del-err">{{ error }}</p>
      <div class="del-acciones">
        <button type="button" class="del-cancelar" :disabled="busy" @click="cerrar">Cancelar</button>
        <button type="button" class="del-si" :disabled="busy" @click="eliminar">
          {{ busy ? 'Eliminando…' : 'Eliminar cuenta' }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { deleteAccount } from '../api.js';

// Tras el borrado el padre sigue el camino de un logout. Si falla (último
// administrador, sin red) la sesión sigue abierta y el motivo se muestra acá.
const emit = defineEmits(['eliminada']);

const abierto = ref(false);
const busy = ref(false);
const error = ref('');

function abrir() { abierto.value = true; error.value = ''; }
function cerrar() { abierto.value = false; error.value = ''; }

async function eliminar() {
  busy.value = true;
  error.value = '';
  try {
    await deleteAccount();
    emit('eliminada');
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.del { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: left; }
.del-btn {
  background: none; border: none; color: #b91c1c; cursor: pointer;
  font-size: 0.85rem; text-decoration: underline; padding: 4px 8px;
}
.del-btn:disabled { color: var(--text-muted); cursor: default; text-decoration: none; }
.del-confirm {
  width: 100%; max-width: 480px; border: 1px solid #fecaca; background: #fef2f2;
  border-radius: 10px; padding: 12px 14px; color: #450a0a;
}
.del-confirm h3 { margin: 0 0 8px; font-size: 1rem; color: #b91c1c; }
.del-confirm p { margin: 0 0 8px; font-size: 0.88rem; line-height: 1.45; }
.del-err { color: #b91c1c; font-weight: 600; }
.del-acciones { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.del-acciones button {
  padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.88rem;
}
.del-acciones button:disabled { opacity: .6; cursor: not-allowed; }
.del-cancelar { background: #fff; color: var(--text); border: 1px solid var(--border); }
.del-si { background: #b91c1c; color: #fff; border: 1px solid #b91c1c; }
</style>
