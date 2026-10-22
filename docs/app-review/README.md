# Camino a la aprobación en las tiendas — lista de pasos

Lista viva para publicar CEPI Telemedicina 1.0 en la App Store. Se actualiza cada vez que
pasa algo: un paso hecho se marca `[x]` con fecha; un paso nuevo se agrega donde toca. El
detalle de cada rechazo está en su propio archivo de esta carpeta.

- App 6812936715 en App Store Connect, cuenta Cempiel Cia. Ltda.
- Envío `8c58c07f-90d1-4115-8c67-e21fd0b09976`, versión 1.0 (11), publicación manual.
- Correo del Account Holder: `developer@cepi.ec`. Llega al buzón de `desarrollo@cepi.ec`.
- Los botones "Submit/Resubmit to App Review" y "Release" los presiona el usuario.

## Hecho

- [x] 2026-10-09 — Ficha de la tienda, App Privacy, build 11 y envío a revisión.
- [x] 2026-10-09 — Solicitud de **distribución no listada** (formulario de Apple). Acuse
      automático ese día: responden "within three business days".
- [x] 2026-10-10 — Respuesta al rechazo **2.1 Information Needed**: dos videos, registro del
      SRI, Notes de revisión (`respuesta-2.1-info-needed-2026-10-10.md`).
- [x] 2026-10-12 — Reenvío a revisión.
- [x] 2026-10-14 — Rechazo **3.2 Business**: app de una organización en distribución pública
      (`rechazo-3.2-business-2026-10-14.md`).
- [x] 2026-10-14 09:34 — Respuesta en "Reply to App Review" pidiendo el estado de la
      solicitud no listada.
- [x] 2026-10-16 — Apple responde: pedir el estado por Contact Us y reenviar cuando aprueben.
      Se abrió el caso 102999076357 y se avisó en el hilo que no se reenviaría antes.
- [x] 2026-10-19 10:56 — **Reenvío a revisión sin respuesta sobre la no listada** (lo pidió el
      usuario: Apple no contestó el caso). Estado: Waiting for Review. Riesgo: otro 3.2.
- [x] 2026-10-19 — **TestFlight externo**: grupo "Médicos CEPI" con
      domenica.palacios.dermatologia@gmail.com; build 11 enviado a Beta App Review (contacto
      y cuenta demo iguales a App Review). La invitación sale sola cuando lo aprueben.
- [x] 2026-10-20 12:20 — **Apple aprueba la distribución no listada** (Developer Support,
      caso 102991437637, correo a `desarrollo@cepi.ec`; respondido a las 14:44). El enlace sale
      en *Pricing and Availability* y vale cuando App Review apruebe la versión. El reenvío
      del 19/10 sigue en revisión: queda cubierto el motivo del rechazo 3.2.
- 2026-10-20 — El hilo de App Review no admite respuesta mientras el envío está en Waiting
      for Review. Decisión del usuario: no escribir por Contact Us; esperar a que Apple escriba
      y contestar en el hilo con:
      > Hello, our unlisted app distribution request has been approved by Apple Developer
      > Support (Case ID 102991437637, October 20, 2026). This addresses the Guideline 3.2
      > rejection of October 14. Submission ID 8c58c07f-90d1-4115-8c67-e21fd0b09976,
      > version 1.0 (11). Thank you.

## Pendiente

1. [x] ~~Decisión de Apple sobre la distribución no listada~~ — aprobada el 2026-10-20.
2. [x] Revisado en *Pricing and Availability*: la app quedó como no listada (2026-10-22).
3. [ ] Confirmar en prod, mientras revisan el reenvío del 19/10:
       - las dos cuentas demo (`CEPI_REVISOR_*` en `.env`) entran y solo ven `cepi-testing`;
       - la sandbox tiene pacientes ficticios visibles (los de las grabaciones se dieron de baja);
       - https://telemedicina.cepi.ec/privacidad.html responde.
4. [x] Reenviada 1.0 (11) el 2026-10-19. Cuando Apple escriba en el hilo (o si vuelve un
       3.2), responder con el texto de arriba.
5. [x] **Publicada el 2026-10-22** (Release manual de la 1.0 (11)). Distribución no listada
       confirmada en *Pricing and Availability*. Enlace:
       `https://apps.apple.com/app/cepi-telemedicina/id6812936715` (Apple tarda hasta 24 h en
       activarlo). Ya está en `AvisoAcceso.vue` y en STATUS.
7. [x] **1.1 (12) enviada a revisión el 2026-10-22** (07:38): ficha de evolución y
       autocompletar de la clave. Release automático al aprobarse. Notas de revisión con
       "WHAT IS NEW IN 1.1" y la distribución no listada ya aprobada.
8. [x] **1.1 (12) aprobada y publicada el 2026-10-22** a las 16:00 (hora de Ecuador), sola
       por el release automático. `itunes.apple.com/lookup?id=6812936715` ya da la 1.1.
6. [ ] Repartir el enlace a los médicos. Cada cuenta nueva sigue entrando como `pendiente`
       hasta que un admin la aprueba.

## Riesgos que pueden salir en la próxima revisión

- **4.8 Sign in with Apple**: la app ofrece "Continuar con Google" y no Apple. Las notas lo
  justifican porque toda cuenta requiere aprobación. Si lo exigen: `/auth/apple` en el
  backend (PAPER §24.4 primero) y el botón en la app.
- **Revisan en iPad** (iPad Air 11", M3). En vertical la app abre con la lista oculta
  ("Elige un paciente" sobre blanco) y aparece una burbuja vacía al abrir un formulario.
  Hoy son cosméticos; corregirlos antes de un nuevo build reduce el riesgo de un rechazo 4.0.
- Cualquier cambio de código obliga a subir un build 12 y a repetir la revisión.

## Si rechazan la distribución no listada

- **Custom App** por Apple Business Manager: exige el D-U-N-S de Cempiel y que cada
  organización receptora tenga su propio Business Manager. No sirve para médicos
  independientes.
- Alternativa sin App Store: TestFlight externo (máximo 10 000 testers, builds vencen a los
  90 días). Ver PAPER §24.7.
- Decidir con el usuario y registrar la decisión en PAPER §24.7.

---

# Android (Play)

- App `4974089655011192327`, cuenta Cempiel (`desarrollo@cepi.ec`), paquete `ec.cepi.telemedicina`.
- [x] 2026-10-09 — Envío 1 (prueba cerrada Alpha, ficha, contenido, configuración) a revisión.
- [x] 2026-10-09 — **Aprobado y publicado** el mismo día (Actividad de envíos: "Publicada").
      Versión 7 (2.3.0) en la pista cerrada Alpha, solo Ecuador, lista "Testers internos CEPI".
- Enlace de descarga: `https://play.google.com/apps/testing/ec.cepi.telemedicina` (la ficha
  pública `details?id=…` da 404 mientras la app esté solo en la pista cerrada). Está en el
  aviso de acceso de telemedicina.cepi.ec desde el 2026-10-15.
- [x] 2026-10-15 — **Producción enviada a revisión** (10:20 hora de Ecuador): versión 7 (2.3.0),
      lanzamiento completo, solo Ecuador. Decisión del usuario: la app va a producción
      normal; que aparezca en las búsquedas de Play no importa, el acceso lo controla la
      aprobación de la cuenta. Google indica hasta 7 días. La publicación gestionada está
      desactivada: al aprobarse se publica sola.
- [x] 2026-10-22 — **Producción aprobada y publicada**: la ficha pública
      `https://play.google.com/store/apps/details?id=ec.cepi.telemedicina` responde 200.
- [x] 2026-10-22 — El botón de Play en `cepi-frontend/src/components/AvisoAcceso.vue` apunta a
      la ficha pública; la nota de la lista de testers se quitó.

## Paridad de versiones

Android 7 (2.3.0) e iOS 1.0 (11) salieron del mismo commit (`05d312e`, 2026-10-08) y no hay
cambios en `cepi-android/` ni `cepi-ios/` después. Diferencia funcional: iOS no tiene dictado
ni push (PAPER §24.9, fases 4 y 5); Android sí.
