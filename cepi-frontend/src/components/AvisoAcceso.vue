<template>
  <!-- La app se puede descargar y la cuenta se puede crear, pero no es un servicio público:
       lo que se ve después depende de que CEPI apruebe la cuenta (PAPER §24.7). -->
  <p class="aviso">
    CEPI Telemedicina es la herramienta de trabajo de los médicos que colaboran con CEPI
    Centro de la Piel. No es un servicio para pacientes ni para el público. Cualquiera puede
    descargar la app o crear una cuenta, pero solo se usa cuando un administrador de CEPI
    la aprueba.
  </p>
</template>

<style scoped>
.aviso {
  margin: 4px 0 0; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--text-muted);
  font-size: 12px; line-height: 1.45;
}
</style>
