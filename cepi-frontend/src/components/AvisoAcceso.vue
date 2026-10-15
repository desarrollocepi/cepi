<template>
  <!-- La app se puede descargar y la cuenta se puede crear, pero no es un servicio público:
       lo que se ve después depende de que CEPI apruebe la cuenta (PAPER §24.7). -->
  <div class="aviso">
    <p>
      CEPI Telemedicina es la herramienta de trabajo de los médicos que colaboran con CEPI
      Centro de la Piel. No es un servicio para pacientes ni para el público. Cualquiera puede
      descargar la app o crear una cuenta, pero solo se usa cuando un administrador de CEPI
      la aprueba.
    </p>
    <div class="tiendas">
      <!-- Android está en la pista cerrada de Play: la ficha pública da 404 y este enlace
           solo deja instalar a las cuentas de Google de la lista de testers. -->
      <a class="tienda" :href="PLAY_URL" target="_blank" rel="noopener">Android · Google Play</a>
      <!-- Nunca se oculta: deshabilitado hasta que Apple apruebe la versión no listada. -->
      <button type="button" class="tienda" disabled title="La app de iPhone y iPad está en revisión de Apple">
        iPhone · App Store
      </button>
    </div>
    <p class="nota">
      En Google Play, tu cuenta de Google tiene que estar en la lista de médicos de CEPI; pide el
      acceso a <a href="mailto:info@cepi.ec">info@cepi.ec</a>. La app de iPhone y iPad está en
      revisión de Apple.
    </p>
  </div>
</template>

<script setup>
const PLAY_URL = 'https://play.google.com/apps/testing/ec.cepi.telemedicina';
</script>

<style scoped>
.aviso {
  margin: 4px 0 0; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--text-muted);
  font-size: 12px; line-height: 1.45;
  display: flex; flex-direction: column; gap: 8px;
}
.aviso p { margin: 0; }
.aviso a { color: var(--accent); }
.tiendas { display: flex; gap: 8px; flex-wrap: wrap; }
.tienda {
  flex: 1; min-width: 130px; padding: 7px 10px; text-align: center;
  border: 1px solid var(--accent); border-radius: 4px;
  background: transparent; color: var(--accent);
  font-size: 12px; font-weight: 600; text-decoration: none;
}
button.tienda[disabled] {
  border-color: var(--border); color: var(--text-muted); cursor: not-allowed; opacity: 1;
}
.nota { font-size: 11px; }
</style>
