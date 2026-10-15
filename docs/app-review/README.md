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

## Pendiente

1. [ ] **Decisión de Apple sobre la distribución no listada.** Llega por el hilo de App Review
       o por correo a `developer@cepi.ec`. No reenviar antes.
       - Si el 2026-10-17 no hay nada: escribir por
         [Contact Us](https://developer.apple.com/contact/topic/#!/topic/select) → App Review,
         con el ID del envío y la fecha de la solicitud.
2. [ ] **Si la aprueban:** seguir las instrucciones del correo de aprobación. Revisar en
       *Pricing and Availability* que la app quede como no listada.
3. [ ] **Antes de reenviar**, confirmar en prod:
       - las dos cuentas demo (`CEPI_REVISOR_*` en `.env`) entran y solo ven `cepi-testing`;
       - la sandbox tiene pacientes ficticios visibles (los de las grabaciones se dieron de baja);
       - https://telemedicina.cepi.ec/privacidad.html responde.
4. [ ] **Reenviar** 1.0 (11) con "Resubmit to App Review" (lo presiona el usuario).
5. [ ] **Aprobada:** presionar "Release" (publicación manual) y guardar el enlace no listado
       de la App Store aquí y en STATUS. Ponerlo en `cepi-frontend/src/components/AvisoAcceso.vue`:
       el botón "iPhone · App Store" está deshabilitado esperando ese enlace.
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
- [ ] Al publicarse: cambiar el botón de Play en `cepi-frontend/src/components/AvisoAcceso.vue`
      a `https://play.google.com/store/apps/details?id=ec.cepi.telemedicina` y quitar la nota
      de la lista de testers.

## Paridad de versiones

Android 7 (2.3.0) e iOS 1.0 (11) salieron del mismo commit (`05d312e`, 2026-10-08) y no hay
cambios en `cepi-android/` ni `cepi-ios/` después. Diferencia funcional: iOS no tiene dictado
ni push (PAPER §24.9, fases 4 y 5); Android sí.
