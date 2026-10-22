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
      <!-- Android está en producción en Play (solo Ecuador) desde el 2026-10-22. -->
      <a class="tienda" :href="PLAY_URL" target="_blank" rel="noopener">Android · Google Play</a>
      <!-- Distribución no listada: la app no aparece en las búsquedas del App Store, solo se
           llega con este enlace. Sin país en la ruta para que abra la tienda de quien lo toca. -->
      <a class="tienda" :href="APP_STORE_URL" target="_blank" rel="noopener">iPhone · App Store</a>
    </div>
    <p class="nota">
      La app de iPhone y iPad no aparece en las búsquedas del App Store: se instala desde este
      enlace. Para que te aprueben la cuenta, escribe a <a href="mailto:info@cepi.ec">info@cepi.ec</a>.
    </p>
  </div>
</template>

<script setup>
const PLAY_URL = 'https://play.google.com/store/apps/details?id=ec.cepi.telemedicina';
const APP_STORE_URL = 'https://apps.apple.com/app/cepi-telemedicina/id6812936715';
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
