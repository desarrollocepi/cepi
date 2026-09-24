# cepi — STATUS

Estado del proyecto al cierre de la sesión actual.

---

## Sesión 2026-09-24 (2) — Identidades de chat: cuentas padre e hijo

- **Modelo nuevo (PAPER §27, D-Aux-26)**: el remitente de WhatsApp/Telegram es una **cuenta
  hijo** — fila de `users` con `parent_user_id`, que **no inicia sesión** y cuyos mensajes
  corren como el padre. Se evaluó el merge de cuentas y se descartó al medirlo: `users(id)`
  tiene **34 claves foráneas** apuntándole, así que fusionar es reescribir `created_by` de la
  historia clínica sin vuelta atrás. Vincular es un `UPDATE` de una columna; desvincular,
  ponerla en `NULL`.
- **Dos agujeros que aparecieron al mirarlo**, los dos corregidos:
  - `tokenForExternalIdentity` emitía el token **sin `org_id`** y buscaba el remitente entre
    todos los usuarios. Sin org activa el alcance por persona no filtra nada (§13.7): el turno
    de WhatsApp veía a todo el mundo. Ahora el llamador pasa su organización, el actor tiene
    que ser miembro, y una org desconocida da 400 en vez de degradar a «sin filtro».
  - `loginWithGoogle` tenía el mismo bug del token sin `org_id`.
- **El bot deja de necesitar el comodín**: `/auth/external/resolve` acepta el permiso granular
  `auth:external:resolve`. Era la razón por la que los bots corrían con `admin@erp.com`.
- Migración `022_cuentas_padre_hijo.sql` + endpoints `POST/DELETE /api/admin/users/:id/parent`
  (un solo nivel, ambos extremos dentro del alcance de quien administra). **19 tests nuevos**;
  uno verifica explícitamente que vincular **no mueve ninguna fila**.
- **Alta automática**: `POST /auth/external/ensure` da de alta al remitente desconocido como
  identidad sin padre y rol `pendiente`. Email sintético (`wa-593…@whatsapp.local`) y hash
  vacío, así que **nace sin contraseña con la que entrar**. `org` es obligatoria al crear.
- **`cepi-bot`**: los dos canales mandan su organización en cada resolución y, con
  `*_BOT_AUTOALTA=1`, usan `/ensure`. **Sin org configurada el bot no resuelve nada**: falla
  ruidoso en vez de correr sin límite de alcance.
- **Seed 020**: rol `bot_canal` con tres permisos (resolver, crear, vincular) y nada más.
  `bot-telegram` baja de `admin` a ese rol y se agrega `bot-whatsapp`, los dos solo en `cepi`.
- **Consola**: columna *Chat* en Usuarios — vincular, desvincular y ver los canales de cada
  cuenta. Probado contra el stack local de punta a punta.
- Tests: **25** en `cuentas_padre_hijo`, **134** en cepi-bot, **469** en TodoERP.

### ⚠️ Orden de corte en producción (no hacer a medias)

El deploy **no toca** `/opt/cepi/ecosystem.config.cjs`, así que en prod los bots siguen usando
`admin@erp.com` hasta que se cambie a mano. El seed 020 es seguro de desplegar igual: crea rol
y cuenta nuevos y baja el rol de `bot-telegram@cepi.local`, que hoy no usa nadie.

Para completar el corte, **en este orden**:

1. Poner contraseña a `bot-whatsapp@cepi.local` y `bot-telegram@cepi.local` (el seed las deja
   con un hash inválido a propósito) y guardarlas en el vault.
2. Editar `/opt/cepi/ecosystem.config.cjs`: `*_BOT_EMAIL` a las cuentas nuevas, más
   `*_BOT_ORG: 'cepi'` y `*_BOT_AUTOALTA: '1'`. El repo ya tiene esa forma como referencia.
3. `pm2 restart cepi-bot` y probar un mensaje real por cada canal.
4. **Recién entonces** desactivar `admin@erp.com`. Antes de eso, desactivarla deja mudos los
   dos bots.
- ⚠️ **TodoERP `main` ya lleva la migración.** El próximo push a `master` de cepi la aplica en
  producción. Es aditiva (una columna nullable) y el código viejo no la usa, pero conviene
  saberlo antes de desplegar cualquier otra cosa.

---

## Sesión 2026-09-24 — La administración se muda a su propia consola

- **`console.cepi.ec`**: repo propio (`desarrollocepi/cepi-console`, privado), app Vue 3 propia
  y CI propio. Cuatro pantallas: **Usuarios** y **Organizaciones** (migradas de la PWA) más
  **Roles** y **Permisos**, que no existían en ninguna superficie salvo el ERP. La consola no
  muestra datos clínicos ni habla con cepi-bot. PAPER §26, D-Aux-25.
- **Roles y permisos, por fin editables fuera del ERP**: la consola lee el modelo real
  (`users.role_id → roles → role_permissions → permissions`, un bundle con mapa plano por rol)
  y muestra los **permisos efectivos** que resultan de los bundles elegidos. Un bundle que
  además lleva matrices del ERP queda en solo lectura, porque `PUT /api/security/:id` pisa
  `data` entero.
- **Backend**: `GET /api/orgs?all=1` (TodoERP) incluye las orgs desactivadas y expone
  `sandbox`. Sin eso, "Desactivar" una organización era irreversible por UI: desaparecía de la
  lista. Opt-in, y solo para el superadmin.
- **En la PWA** se fueron la ruta `/admin`, sus tres componentes (405 LOC) y doce funciones de
  `api.js` que solo ellos usaban. El botón **Admin ↗** se queda y abre la consola en otra
  pestaña; deshabilitado con el motivo para quien no administra nada.
- **Deploy**: push a `master` de `cepi-console` → `/opt/cepi/console/dist` en el EC2, con
  server block de nginx aparte. Deploy **verde**; sirviendo por IP con `Host: console.cepi.ec`.
  cepi y TodoERP también **publicados en prod**: la PWA ya trae el botón `Admin ↗` y
  `/api/orgs` devuelve `sandbox`.
- **Se rotó la deploy key de TodoERP.** El deploy de cepi empezó a fallar en el paso que clona
  TodoERP (`git@github.com: Permission denied (publickey)`) con GitHub operativo y la key aún
  registrada. Se generó un par nuevo, se registró como deploy key de solo lectura
  (`cepi CI (solo lectura) 2026-09-24`) y se actualizó el secret `TODOERP_DEPLOY_KEY`. Copia
  privada en `~/.ssh/todoerp_ci_deploy_ed25519`. La key vieja (`163557273`) quedó registrada
  sin autenticar y **se borró**. Sigue viva `cepi-vps` (de junio, sin uso desde el 2026-06-30):
  no se tocó por si el ambiente develop la usa.
- **`https://console.cepi.ec` en vivo**: DNS agregado en Rackspace, certificado de Let's
  Encrypt emitido (vence 2026-12-23, renovación automática) y redirect 80→443.
- **GOTCHA de nginx**: las cabeceras de seguridad del server **no llegaban al HTML**. Un
  `add_header` en un nivel más específico no se suma a los del padre, los reemplaza; como
  `location /` sirve la página por `try_files … /index.html`, caía en `location = /index.html`,
  cuyo único `add_header` era Cache-Control. Los assets sí las traían, que es lo que despistaba.
  Se repiten los tres en ese location.
- El certificado renueva solo: `certbot.timer` activo y `certbot renew --dry-run` en verde.
- **Origen OAuth agregado** (2026-09-24): `https://console.cepi.ec` está en *Authorized
  JavaScript origins* del cliente web de `cepi-500221`, junto a `telemedicina` y `casos`.
  Verificado recargando la página del cliente desde cero. Google avisa que la configuración
  tarda **de 5 minutos a algunas horas** en aplicarse, así que el botón de Google puede seguir
  respondiendo `The given origin is not allowed` un rato; el login por email y contraseña
  funciona mientras tanto.
- **Pendiente (riesgo abierto)**: `admin@erp.com` / `Admin123!` —la cuenta seed de
  `002_seed.sql`, con la contraseña escrita en ese archivo y en `TodoERP/CLAUDE.md`— es
  **superadmin activo en producción** y entra desde internet. El seed inserta con `ON CONFLICT
  DO NOTHING`, así que desactivarla o rotarle la clave **no se revierte** en el próximo deploy.
  Antes de desactivarla hay que confirmar que exista otro superadmin real, o se pierde el
  acceso administrativo.
- Tests: verdes en el CI (base desde cero). En local, TodoERP da 2 fallos **previos** y ajenos
  a este cambio, por base desactualizada; cepi-bot 130; 4 nuevos de `orgs_list_all`.

---

## Sesión 2026-09-24 — Derivar a varios, y saber a quién

- **Multiderivación**: se marcan círculos y personas —mezclados— y un botón los manda en una
  sola derivación (iOS, Android y web). A quien ya la tiene pendiente se le muestra la marca
  y no se lo puede repetir. El bot acepta `derivar a <círculo|persona>[, …] [motivo]`
  (`parsearDestinos`); con un destino se comporta igual que antes.
- **Se ve a quién está derivado**: barra sobre el hilo ("↪ Derivado a …", abre el selector),
  la línea de "a cargo" de la lista nombra a todos ("Ana, Beto +2") y el hilo registra la
  derivación **por nombre** (`{{reviewers}}`, que el backend resuelve al derivar).
- **Backend**: `GET /api/review-queue/entity/:id` (quién tiene pendiente esa entidad,
  genérico), `derivados[]` en `/api/patient-assignments` y `reviewer_names` en la respuesta de
  `request_review`. `request_review` ya aceptaba `reviewers[]` + `group_ids[]` en una llamada.
- Tests: TodoERP 440, cepi-bot 130, Android 81, iOS 60 — todos en verde.
- **Publicado**: web y backend en prod (deploy verde), Android **6 (2.2.0)** en la pista
  interna de Play e iOS build **10** en TestFlight. PAPER §24.2.

---

## Sesión 2026-09-23 — Derivar: solo la gente de tu organización

- **El alcance de personas es la org activa, no solo la sandbox.** Los miembros de un círculo,
  sus conteos y los destinos de una derivación, asignación, revisión o recordatorio se
  filtraban por org **solo** desde una sandbox; en `cepi` la lista traía a los médicos de todas
  las orgs, a los que el backend igual les rechazaba la derivación. `reachableOrgId` en
  TodoERP (PAPER §13.7). Sin org activa (API key) no se filtra.
- **El círculo "todos" es toda la gente de la org**, esté o no en un círculo: quien no está en
  ninguno tiene que ser alcanzable desde algún lado. `/api/groups/:slug/members` resuelve
  también el grupo virtual, así que la lista que se ve es a quién le va a llegar. Las apps ya
  lo despliegan como a cualquier círculo.
- **Cuentas de servicio**: `users.data.service = true` (seeds 010, 011 y 014 — Espejo DrPro,
  Bot Telegram, Importador de patología). No se listan ni reciben derivaciones. Tampoco se
  listan usuarios inactivos.
- **Un círculo sin miembros de la org no se ofrece** en iOS, Android y web. Excepción
  consciente a "nunca ocultes un botón": derivar ahí no llega a nadie.
- **Limpieza de membresías en prod** (a mano, con respaldo en `respaldo_membresias_cepi_20260923`):
  `cepi` tenía 30 de los 32 usuarios activos —la carga de médicos del 2026-07-01 y las 5 cuentas
  demo `@cepi.local`—, así que Dermatología mostraba 13 personas. Quedaron los que interactuaron
  desde el 16/09: Santiago Andrade, Gabriela Ramon, Claudia Guillén, Maria Basantes, Desarrollo
  CEPI, System Administrator, más el Bot Telegram. Nadie perdió datos ni su cuenta, y siguen en
  `cepi-drpro`. Dermatología 13 → 2, Comité 5 → 1, Medicina interna 6 → 1.
  - **Pendiente**: el seed 007 vuelve a meter a las 5 demo en `cepi` en cada deploy. En local
    hacen falta (el stack de desarrollo entra como `primario@cepi.local`), así que hay que
    distinguir dev de prod antes de tocarlo.
- Tests de TodoERP: 437 pasan (dos nuevos: el círculo "todos" y las cuentas de servicio).
- **Publicado**: web en prod (dos deploys verdes), Android **5 (2.1.0)** en la pista interna de
  Play y iOS build **9** en TestFlight.

---

## Sesión 2026-09-22 — Estado de la ficha en la lista (iOS y Android)

- Cada fila de Pacientes lleva a la derecha un **LED** con el estado de la consulta más
  reciente; la lista se **ordena por estado** y debajo del buscador hay un **filtro por estado**
  con el conteo de cada uno (los vacíos, deshabilitados). Tabla de estados, orden y colores en
  PAPER §24.2.1. Sin cambios de backend: el `estado` ya venía en `/api/patient-assignments`.
- **Android:** `EstadoFicha.kt`, `LedEstado.kt`, `PacientesModelo`, `FilaPacienteVista`,
  `ListaPacientes`. 81 tests JVM en verde (+3). Probado en emulador contra el stack local:
  131 pacientes, "Revisión solicitada · 7" arriba, filtro "En curso · 54" solo deja los azules.
- **iOS:** `EstadoFicha.swift`, `LedEstado.swift`, `PacientesModelo`, `PacienteFila`,
  `PacientesView` (filtro con `safeAreaInset` bajo el buscador, que ahora queda fijo:
  `.navigationBarDrawer(displayMode: .always)`), tests en `PacientesTests`,
  `PacientesCargaTests` y `ContratoTests`. **Probado en la Mac** (2026-09-23, por ssh):
  `xcodebuild test` en el simulador iPhone 17 Pro / iOS 26.5, **60 tests de unidad en verde**.
- La Mac de compilación ahora se alcanza desde esta máquina por **`ssh mac`**
  (`cepi@192.168.100.217`, llave instalada, repo en `~/cepi`, Xcode 26.5). Se sincroniza por
  git: la rama `feat/android-nativa` está en GitHub y bajada allá.
- **TestFlight: build 8 subido** (2026-09-23, `CURRENT_PROJECT_VERSION = 8`, 1.0). El primer
  intento falló con *Your session has expired* / `No signing certificate "iOS Distribution"
  found`: la sesión de `developer@cepi.ec` en Xcode estaba vencida. El usuario volvió a entrar
  en Xcode → Settings → Accounts y entonces el certificado de distribución se creó solo.
- **Cómo se sube desde acá, sin GUI ni llave de la API:** `ssh mac`, desbloquear el llavero
  (`security unlock-keychain`), `xcodebuild archive … -allowProvisioningUpdates` y
  `xcodebuild -exportArchive` con un `ExportOptions.plist` de `method: app-store-connect` y
  **`destination: upload`** — usa la sesión de Xcode, así que no hace falta contraseña
  específica de app ni App Store Connect API. El grupo interno "CEPI interno" distribuye
  automáticamente cuando Apple termina de procesar.
- La web (`ChatList.vue`) todavía no muestra el estado.

---

## Sesión 2026-09-22 — App nativa Android, fase 6

- **Macrobenchmark** en `baselineprofile/Mediciones.kt` (arranque con y sin perfil, scroll,
  memoria). En emulador por `adb reverse`: arranque en frío con sesión → lista con datos en
  **549 ms** con el perfil (617 sin); scroll con frames tarde (P95 11,3 ms, render por software);
  101 MB con paciente y galería. Tabla completa en PAPER §25.5.
- La primera corrida daba 1,6 s de arranque: la red del emulador hacia 10.0.2.2 suma ~500 ms
  por pedido. Medido con `nc` desde el emulador (488–1000 ms) contra 7 ms por `adb reverse`.
- Baseline Profile regenerado con el código de las fases 3–5 (1.768 reglas de la app).
- **Release firmado:** AAB con la clave de subida, `versionCode 3`, perfil incluido; el APK
  release ignora los extras de desarrollo (probado en emulador).
- **Pista interna de Play:** versión **4 (2.0.0)** activa, reemplaza a la 2 de Capacitor. Se
  subió desde Play Console con el perfil de navegador del proyecto (`.pw-profile`). La 3 quedó
  inactiva: exigía micrófono y Play perdía 20 dispositivos; la 4 lo declara opcional.
  Testers: los 3 de TestFlight (developer@cepi.ec, gabrielaramong@gmail.com,
  seyacat@gmail.com) más sandrade@dotrino.com.
- La huella de Play App Signing (`99:C5:32…9D:2C`) quedó registrada como cliente OAuth
  Android en `cepi-500221`: Google funciona en la build de Play (falta probarlo en un teléfono
  con cuenta). Tampoco hay teléfono conectado para la medición real: los números son de
  emulador.

Pendientes de las fases 4–6 que necesitan algo que no está en la máquina:
- teléfono Android real: medición de §25.5, transcripción del dictado, ingreso con Google con
  una cuenta;
- credencial de FCM en un backend (local o prod): ver llegar un push;
- Google Cloud avisa: desde el 11 de octubre de 2026 exige verificación en 2 pasos a
  desarrollo@cepi.ec, y el administrador de la organización tiene que habilitarla.
- Play avisa como crítico: registrar las apps para la verificación de desarrolladores de
  Android antes del 30 de septiembre de 2026.

---

## Sesión 2026-09-22 — App nativa Android, fase 5

- **Push y bandeja.** Probado en emulador contra el stack local:
  - al entrar pidió el permiso de notificaciones; el token de FCM salió del proyecto real
    (`telemedicina-cepi`) y quedó en `device_tokens` como `android` de derma1;
  - la campana mostró 3 avisos; tocar el de la derivación hecha desde Android en la fase 3
    abrió a Andrés Herrera;
  - el intent que arma el sistema al tocar una notificación abrió al paciente con la app en
    segundo plano y en arranque en frío (esperando la sesión);
  - cerrar sesión borró el token (1 → 0).
- **Sin probar:** la entrega real de un push. El backend local no tiene la service account de
  FCM (`FCM no configurado`), así que ni el aviso del sistema ni el de la app abierta se vieron.
  Queda para producción o para un backend local con la credencial.
- Bug de la app encontrado en la prueba y arreglado: el efecto que abría el paciente se
  cancelaba solo al limpiar el destino.
- Tests: **78 JVM**.

---

## Sesión 2026-09-22 — App nativa Android, fase 4

- **Dictado** en el composer con el reconocedor del sistema. En el emulador (Android 16): el
  motor local no tiene es-EC (error 12), sí es-US sin bajar (error 13); la app pidió la
  descarga, el sistema bajó el español (45 MB) y **con modo avión** el reconocedor quedó
  escuchando en es-US. La transcripción no se probó: el emulador headless no tiene entrada de
  audio (sin soporte de PulseAudio en `qemu-system-x86_64-headless`).
- **Google**: el botón abre Credential Manager; el emulador no tiene cuenta de Google, así que
  el sistema ofrece agregar una y cancelar vuelve al login sin error. El ingreso de punta a
  punta queda por probar en un teléfono con cuenta. Debug y release salen firmados con la
  clave de subida (SHA-1 `67:09:E3…BA:98`, la registrada en el cliente OAuth Android).
- Tests: **73 JVM**.

---

## Sesión 2026-09-21 (noche) — App nativa Android, fase 3

- **Ficha por formularios:** los 10 tipos de campo de `BotForm.vue` en una hoja inferior
  (opción única que se envía al elegir, grupos con Guardar, texto, área, fecha, CIE-10,
  mapa corporal de 38 regiones, subida de imágenes, búsqueda de registros), Secciones con lo
  completo marcado, auto-form por paciente, Nueva consulta y Derivar (círculo, persona o
  responsable del caso).
- **Probado en emulador contra el stack local:** con el auto-form se recorrió la ficha de un
  paciente de 1.4 a 8 hasta "Ficha completa"; el episodio guardó CIE-10, semáforo, gravedad,
  regiones, próximo control y BLINK. Secciones abre un grupo ya lleno con su valor. Derivar a
  Dermatología creó el aviso de revisión para derma1 y volvió a la lista. Nueva consulta creó
  el episodio. La variante minificada (R8) abre formularios sin errores.
- Tests: **71 JVM** en cepi-android.

Pendiente fuera de la app (backend):
- **Nadie puede registrar el consentimiento de la sección 8.** Ningún rol tiene
  `entity:18000000-…:record:create` (Consentimiento) en `002_medical_roles_perms.sql`, tampoco
  en `main`: la foto se sube, pero el bot responde 403 al ligarla. Pasa igual en web, iOS y
  Android.
- La derivación a un círculo crea el aviso, pero `review-queue` de derma1 no lista al
  paciente (el episodio del seed figura `cerrado`). No lo investigué.

---

## Sesión 2026-09-21 (tarde) — App nativa Android, fase 2

- **Paciente abierto** con Chat · Ficha · Imágenes deslizando (`HorizontalPager`). Hilo por
  consulta, composer, pendiente sí/no, respuestas rápidas, fotos de galería y cámara, imágenes
  inline con visor y zoom. Ficha: `ficha.html` en `WebView`, con consultas, cambios en rojo,
  guardar (`ficha_save`) e imprimir. **Galería** de la org con buscador y paginado.
- **Baseline Profile** generado en emulador contra el stack local (1.511 reglas de la app);
  release con R8: 2,2 MB.
- **Probado en emulador** con TodoERP + cepi-bot (LLM `stub`, sin Telegram): un turno enviado
  desde Android aparece igual para otro profesional (`patient-thread` como derma1, autor "Dr.
  Primario Demo"). Una foto de 6000×4000 con GPS llega al backend como JPEG 4096×2731 sin EXIF.
- Tests: **53 JVM** en cepi-android.

Dos cosas del entorno local, no de la app:
- El TodoERP local está en `fix/orgs-superadmin-nombres`, sin `filter_or`: la galería de
  cepi-bot devuelve todo para cualquier búsqueda que encuentre algo. En `main` (lo que despliega
  el CI) sí está. Las imágenes de los seeds dan 404: no hay archivos.
- El emulador (SwiftShader) se cayó tres veces al pintar la Ficha: el proceso del emulador, sin
  crash de la app en logcat. Abriendo el paciente desde la lista no pasó. Causa no aislada; a
  confirmar en un teléfono real.

---

## Sesión 2026-09-21 — App nativa Android, fases 0 y 1

- **Decisión (PAPER §25, D-Aux-24):** Android deja el WebView de Capacitor y pasa a
  **Kotlin + Jetpack Compose**, con el alcance de iOS. Sin framework multiplataforma: iOS ya
  está en SwiftUI, así que lo que se comparte es el contrato, no el código.
- **`cepi-android/`:** AGP 9.4, Kotlin 2.4, Compose BOM 2026.09, `minSdk 24`, `compileSdk 37`.
  Dependencias: AndroidX, kotlinx.serialization, coroutines y OkHttp. Login con email,
  sesión deslizante con el JWT cifrado por el Android Keystore, cambio de org, lista con
  "revisar" y a cargo, búsqueda sin tildes, alta, borrado (supermédico), eliminar la cuenta
  y cuenta pendiente. Galería y paciente abierto son pantallas que dicen que llegan en la fase 2.
- **Probado en emulador (Android 16) contra TodoERP local:** el usuario demo entra solo con
  los extras de debug, ve su lista, cambia a CEPI Consultorio, busca, da de alta un paciente
  (quedó "Prueba Android Nativa", CC 9990001112, en la base local) y, tras matar el proceso,
  vuelve sin login.
- Release con R8: **1,8 MB** (la APK Capacitor sale sin minificar).

Tests:
- cepi-android: **29 JVM** (contrato, sesión, lista y carga con cambio de org), los de iOS
  portados más 401/403 de otras llamadas y fallos parciales de la carga.

Pendiente de la fase 2: paciente (Chat · Ficha · Imágenes), Galería, Coil y Baseline Profile.

---

## Sesión 2026-09-18 — Galería, secciones del paciente y borrado por el supermédico

- **Estructura nueva (PAPER §24.2.1, D-Aux-22), en iOS y en la web:** fuera del paciente,
  **Pacientes** y **Galería** (todas las imágenes de la org, con buscador por nombre, cédula,
  diagnóstico, CIE-10 y fecha); dentro del paciente, **Chat · Ficha · Imágenes**, que en el
  iPhone se pasan deslizando. La ficha dejó de abrirse desde "Acciones": es una sección.
- **Borrado de paciente (D-Aux-23):** suave, solo para `supermedico`, y al volver a dar de
  alta la misma cédula en la misma org reaparece el registro anterior en vez de duplicarse.
  Son dos capacidades genéricas de TodoERP que la definición del paciente enciende:
  `config.delete_permission` (borrar deja de ser parte de editar) y `config.natural_key`.
- **TodoERP genérico:** `q_fields` para acotar la búsqueda por columnas, `filter[x][in]`,
  `filter[x][active]` (no arrastrar hijos de un padre borrado), `filter_or[...]` y
  `with_total`; `DELETE /api/entities/:id` ya no exige `record_type` si el id es un registro.
- **Galería sin N+1:** `cepi-bot/src/galeria.ts` resuelve la página en 3 consultas fijas
  (imágenes + pacientes + episodios de esa página) y 2 más cuando hay búsqueda.
  Medido en local: 135 ms una página de 60, 15–40 ms filtrada.

Tests:
- TodoERP: **443 passed**. cepi-bot: **121 passed**.
- cepi-ios: **57 de unidad** y **8 de UI** contra el stack local, las ocho en una sola corrida.
- Web (Playwright): galería con 60 fotos, búsqueda por cédula, las tres secciones del
  paciente y el botón de borrar visible solo para el supermédico.

Dos cosas que costó ver, por si vuelven a aparecer:
- Los UI tests fallaban en la ficha y en el cambio de org por un **backend local viejo**
  todavía en marcha: ordenaba las organizaciones por nombre, así que tras renombrarlas
  (`medical-seed/019`) la sesión entraba al consultorio y el paciente de prueba, que vive en
  `cepi`, no se veía. Reiniciar el proceso lo arregló; el orden real es por antigüedad.
- `OrganizacionUITests` comparaba filas por la primera etiqueta de la celda, que es el círculo
  de iniciales, y "FS" sale igual en las dos orgs. El nombre lleva ahora
  `accessibilityIdentifier("paciente.nombre")`.

Pendiente de decisión (no lo toqué):
- Con el admin de organización, otorgar un rol exige tener sus permisos (`assertCanGrant`), y
  **ningún rol posee `medico_primario_perms`**: solo el comodín del superadmin puede conceder
  el rol, y en `STAGE=DEVELOP` ese comodín no cuenta a propósito. En producción funciona, pero
  un admin de organización nunca podrá aprobar a un médico. Si la idea era que sí, hay que
  darle al rol `admin` los paquetes clínicos que va a conceder. En local, por eso,
  `scripts/cuenta-revisor.mjs` asigna el rol en la base.

---

## Sesión 2026-09-17 — Orgs por registro, DrPro aparte, sandbox para Apple y E2E del revisor

- **Git:** TodoERP dejó de ser submódulo (lo hizo la otra máquina) y ya es un repo aparte en
  `./TodoERP`, remote `desarrollocepi/TodoERP`. Se integró `ci/deploy-prod` en
  `feat/ios-nativa`. TodoERP `main` = `feat/espejo-drpro` = `7556db3`.
- **Deploy por CI** (`docs/DEPLOY.md`): el ensayo en `ci/orgs-drpro-sandbox` (run 35185938792)
  pasó tests y el dry-run contra prod. SQL pendiente: 021, 014–018, con el ensayo en
  `ROLLBACK` OK. **Falta el push de `feat/ios-nativa` a `master`**, que es lo que despliega.
- **Organizaciones (D-Aux-21, PAPER §13.7):** paciente, informe de patología y adjuntos son
  de UNA org. `cepi` es telemedicina, `cepi-drpro` el consultorio (espejo DrPro, patología) y
  `cepi-testing` la sandbox, aislada también en personas. `/api/drpro`, `/api/doctopro` y
  `/api/patologia` solo abren con la feature en la org activa. Los seeds 017/018 reparten los
  datos existentes; lo de una sola vez queda marcado en la org.
- **Borrado de cuenta** (App Store 5.1.1(v)) en iOS, web y APK; `DELETE /api/auth/me`
  anonimiza y conserva el nombre del profesional. Ya estaba en prod (TodoERP `f7b63f7`); la
  UI web e iOS llega con el próximo deploy o build.
- **iOS:**
  - "Sin conexión con el servidor" al abrir un paciente en el iPhone: reintento ante
    `networkConnectionLost`, código de URLError en el mensaje y en el log.
  - Se quitó el micrófono gris con "Dictado: llega en la fase 4".
  - La confirmación de borrar la cuenta desde el menú no se presentaba (alerta colgada de un
    `Menu` en la barra): ahora la presenta la lista.
- **App Store Connect:** app "CEPI Telemedicina" creada. TestFlight con el grupo interno
  "CEPI interno" (distribución automática) y los builds 1 y 2.
- **E2E de la cuenta del revisor** (solo sandbox, login a mano):
  `scripts/cuenta-revisor.mjs` + `RevisorUITests`.

Tests:
- TodoERP: **396 passed**.
- cepi-bot: **105 passed**. En esta Mac hicieron falta los binarios darwin de rollup y esbuild.
- cepi-ios: **52 de unidad** y **6 de UI** contra el stack local, en verde.
- Web (Playwright): el revisor solo ve ficticios; `primario` ve registros distintos en `cepi`
  y `cepi-drpro`.

**Pendiente (usuario):**
1. Push a `master` para desplegar.
2. Después del deploy:
   - revisar quién quedó en `cepi-drpro` (el seed copió a todos los de `cepi`);
   - confirmar que `DRPRO_MEDICO_EMAIL` es una cuenta existente;
   - crear en prod la cuenta demo de Apple solo en `cepi-testing` y darle a la sandbox un
     colega en `dermatologia` para poder mostrar la derivación.
3. Teléfono de contacto para la revisión beta.
4. Estado de comerciante UE en App Store Connect.

---

## Sesión 2026-09-16 — App iOS: fase 3 (ficha nativa) y primer deploy al iPhone

- **Git:** `feat/ios-nativa` subida a GitHub, con los 3 commits que venían de la otra
  máquina. TodoERP ahora es `desarrollocepi/TodoERP` (privado); el commit al que apunta el
  submódulo está en su remoto.
- **Fase 3 — ficha nativa** (`cepi-ios/CEPITelemedicina/Ficha/`):
  - Los formularios del bot se pintan nativos con los 10 tipos de campo de `BotForm.vue`;
    uno desconocido cae a texto. Van en una hoja sobre el hilo, con Cerrar y Guardar en la
    barra.
  - Mapa corporal con las regiones de `BodyMapField.vue` (son 38, no 36 como dice su
    comentario), fotos múltiples (JPEG sin GPS), CIE-10 del ERP y búsqueda de entidad paginada.
  - Secciones de la ficha por categoría, auto-form por paciente (apagado por defecto, como la
    web) y nueva consulta.
  - Derivar: a toda la red, a un círculo o especialidad, a una persona o al responsable del caso.
  - Visor de la ficha: `ficha.html` en WKWebView cargado del servidor (`CEPI_WEB_BASE` en
    local), paginado por consulta, con lo cambiado respecto de la anterior en rojo, guardar
    (`ficha_save`) e imprimir.
- **Bug que encontró el UI test:** con el formulario dentro del hilo, el teclado y el composer
  tapaban su botón Guardar y el envío nunca salía (confirmado con cuadros del video de
  XCTest). Por eso el formulario pasó a una hoja.

Tests: `cepi-ios` **39 passed**, 0 warnings.
- 36 de unidad: contrato con los formularios reales del bot, lógica de formulario, regiones,
  secciones y datos del visor.
- 3 de UI de punta a punta contra el stack local: un turno en el hilo, un grupo de texto (3.2)
  y una pregunta de opción (1.4), guardados y comprobados en el backend.

**Deploy al iPhone:** un iPhone 11 (iOS 26.6.1) quedó registrado en el equipo **Cempiel Cia.
LTDA.** (`KLR354RZKZ`, fijo en el proyecto). Build Release firmado, instalado y abierto con
`devicectl`; desde la pantalla de inicio usa producción. Para repetir:
`xcodebuild build -project cepi-ios/CEPITelemedicina.xcodeproj -scheme CEPITelemedicina -configuration Release -destination "id=<UDID>" -allowProvisioningUpdates`
y después `xcrun devicectl device install app --device <id> <ruta del .app>`
(`xcrun devicectl list devices` da los ids). Requisitos que ya quedaron hechos: Apple ID en
Xcode, Modo de desarrollador en el teléfono y el dispositivo registrado en el portal.

**Notas del entorno:**
- El simulador de esta Mac Intel falla en corridas largas de UI tests ("Timed out while
  fetching snapshot from testmanagerd"). `xcrun simctl erase` y volver a arrancarlo lo resolvió.
- Playwright MCP agregado para este proyecto (scope local, con Node 24).
- App Store Connect API: no se pidió acceso. Exige aceptar condiciones en nombre de Cempiel
  y una revisión de Apple; solo hace falta para automatizar TestFlight.

**Pendiente:** uso real en el iPhone; fase 4 (dictado y Google Sign-In) y fase 5 (push: llave
APNs y app iOS en Firebase).

---

## Sesión 2026-09-14 — App nativa iOS (SwiftUI), fases 0–2

El repo pasó a una Mac (MacBook Pro 2020 **Intel**, macOS 26.6, Xcode 26.5) para
construir la app iOS. Decisiones del dueño: destino **iPhone/iPad** (no Mac de
escritorio); **Android sigue en Capacitor**; v1 = Telemedicina + Push y bandeja.

- **PAPER §24 (D-Aux-19)**: SwiftUI nativo en lugar de React Native o Capacitor iOS.
  Incluye el contrato con el backend (sin cambios), objetivos de rendimiento medibles,
  cuentas por fase y un bloqueante de revisión de Apple: borrar la cuenta desde la app,
  guía 5.1.1(v), porque el login con Google crea cuentas.
- **`cepi-ios/`**: proyecto Xcode con carpetas sincronizadas (agregar un `.swift` no toca
  el `pbxproj`), iOS 17+, Swift 6 estricto, sin dependencias de terceros.
  - Sesión: login con email, JWT en Keychain, sesión deslizante con `/me` al abrir y al
    volver a primer plano (si pasaron más de 30 min). Un 401 lleva al login; un 403 no.
    Cambio de organización activa.
  - Lista de pacientes: pide pacientes, review-queue y asignaciones en paralelo; pone
    "revisar" primero, ordenado por vencimiento; búsqueda sin tildes con la clave
    precalculada por carga; alta de paciente; recarga cada 20 s en primer plano.
  - Hilo del paciente (fase 2): consultas paginadas como en `IntakeChat.vue`
    ("Consulta 2/2 · 14 sept", solo lectura en las anteriores), mensajes de todos con el
    autor una vez por racha, aviso de activación una sola vez, confirmación sí/no,
    respuestas rápidas y nueva consulta. Fotos de galería y cámara → JPEG sin metadatos
    (sin GPS), lado mayor ≤ 4096 px → `/api/attachments`. Imágenes inline pedidas con
    Bearer, reducidas y en caché, con visor de zoom. Secciones, ficha y derivar se ven
    grises hasta la fase 3; dictado, hasta la fase 4.
  - En Debug: `CEPI_BOT_BASE` (cepi-bot en otro host) y `CEPI_DEV_EMAIL`/`PASSWORD`/`PACIENTE`
    para entrar y abrir un hilo sin tocar la pantalla.
- `CLAUDE.md` y `cepi-frontend/NATIVE.md` apuntan a `cepi-ios/` para iOS.

Tests: `cepi-ios` **24 passed**, 0 warnings con la concurrencia estricta de Swift 6.
- 23 de unidad (Swift Testing): contrato JSON con respuestas reales del stack local
  (sesión, lista, chat, hilo, sesiones, adjuntos), orden y búsqueda de la lista, consultas
  del hilo, marcadores de imagen y preparación de fotos.
- 1 de UI (`HiloFlujoUITests`), de punta a punta contra el stack local: entra como
  `primario@cepi.local`, escribe y envía un turno, espera la respuesta del bot y comprueba
  en `/api/patient-thread` que quedó en el hilo que lee la web. También mide que el último
  mensaje quede por encima del composer, al abrir y tras la respuesta. Pasó en 47 s.

Primer build + tests: ~13 min en esta Mac; los incrementales, 1–4 min.

**Verificado contra backend local** (no producción, que tiene PII real):
- Fase 1: `primario` entra por el login real y ve los 50 pacientes ficticios. Una
  derivación real (`derma2` → `escalar a primario`, por cepi-bot) sube al paciente arriba
  con "revisar" y "a cargo" en la siguiente recarga automática.
- Fase 2: el turno enviado desde la app aparece en el hilo del backend (UI test).

**Corregido en la sesión:** al abrir el hilo, el último mensaje quedaba fuera de la
pantalla, debajo del composer. Un UI test de diagnóstico midió la causa: `LazyVStack`
estima las alturas de lo que no midió, y "ir al final" quedaba corto. El hilo pasó a
`VStack` (una página es una sola consulta), y el UI test lo comprueba desde entonces.

**Pendiente:** Google sigue deshabilitado, con la explicación visible, hasta la fase 4.

**Stack local en esta Mac** (sin sudo; Homebrew pertenece al usuario `crifa`):
- Postgres 18: base propia en `~/.cepi-dev/pg18`, con los binarios de
  `/Library/PostgreSQL/18` (el servicio de EDB está apagado y es de otro usuario).
  pgvector 0.8.6 compilado en `~/.cepi-dev/pgvector` y cargado con
  `extension_control_path`. Arranque:
  `/Library/PostgreSQL/18/bin/pg_ctl -D ~/.cepi-dev/pg18 -l ~/.cepi-dev/pg18.log -o "-p 5432 -k /tmp" -w start`.
- Datos: `PATH=/Library/PostgreSQL/18/bin:$PATH bash scripts/reset-cepi.sh`; después
  arrancar el backend (crea las tablas por tipo) y correr
  `TodoERP/database/medical-seed/seeder/run.sh`.
- TodoERP (:3001) y cepi-bot (:3002) con Node 24 (`/usr/local/opt/node/bin`) y las
  variables de `ecosystem.config.cjs`. cepi-bot con Telegram y DeepSeek vacíos y
  `CEPI_LLM_PROVIDER=stub` (ver el aviso en `CLAUDE.md`).

**Entorno de esta Mac** (no afecta a `cepi-ios/`): `node` apunta al nvm de otro usuario
(`/Users/crifa/.nvm/…/v16.0.0`), demasiado viejo para Vite 5 / Capacitor 8; Node 24.1
está en `/usr/local/opt/node/bin`. `cepi-frontend/node_modules` vino de Linux (solo
binarios `rollup-linux-*`) y `package.json` declara `@rollup/rollup-linux-x64-gnu` como
dependencia, así que build e install del frontend en Mac probablemente fallen (no
probado). No hay sesión de `gh` ni llave SSH para pushear.

---

## Sesión 2026-06-09 — Telemedicina (primario → turno → especialistas)

Capa de teleconsulta sobre lo ya construido. Plan completo en
`cepi-frontend/public/TELEMEDICINA.md` (reescrito, 16 secciones, aterrizado en
código real). Decisiones del dueño: 1B (roles nuevos separados), 2B (el
**episodio** es el caso que viaja, sin entidad nueva), 3A+B+C (estrategia de
turno configurable), 4C (círculos por especialidad + nombrados), 5A (slice
end-to-end), 6C (PWA instalable + Web Push + cola offline), 7A+B+C (4 canales),
8A (ingesta texto libre con gate + guiada).

- **Capacidad genérica de grupos de usuarios** (migración `015_user_groups.sql`):
  `user_groups` + `user_group_members` + `push_subscriptions`. Router genérico
  `/api/groups` (`groupsRouter.ts`, perms `groups:read`/`groups:manage`) + tools
  MCP `groups.*`. Naming 100% genérico; el seed clínico le da semántica.
- **claim / assign genéricos** (`routes/entities/{claim,assign}.ts`, montados en
  `entitiesRouter`): `POST /api/entities/:id/claim` (bandeja compartida, 409 si
  ya reclamado) y `/assign` (manual). Perms `entities:claim`/`entities:assign`.
  Tools MCP `entities.claim`/`entities.assign`.
- **request_review → grupo**: `requestReview.ts` ahora acepta `group_id`/`group_ids`
  (UUID o slug), resuelve miembros vía `resolveGroupMemberIds`, dedup + excluye al
  solicitante. Tool MCP extendida.
- **2 canales de notificación nuevos** (`channels/{telegram,webPush}.ts`,
  registrados): `telegram` (resuelve `users.data.telegram_id`, `TELEGRAM_BOT_TOKEN`)
  y `web_push` (VAPID + `web-push` opcional vía import dinámico). Endpoint
  `/api/push/subscribe` + `vapid-public-key` (`pushRouter.ts`). Ambos degradan a
  `ok:false` sin config, como email sin Brevo.
- **Seed telemedicina**: 3 roles nuevos `medico_primario`/`residente`/`especialista`
  + bundles (002); episodio gana estados `enviada/en_triage/respondida/derivada` +
  campos `responsable_actual_id`/`turno_claimed_by`/`derivado_a`/`especialidad`/
  `prioridad`/`recomendacion`/`recomendacion_por`/`recomendacion_at`/
  `medico_primario_id` (001). Grupos de especialidad/círculo + turno + 4 usuarios
  demo + membresías (`007_telemedicine.sql`, en `apply.sh`).
- **Comandos del bot** (`cepi-bot/src/server.ts`): `enviar caso [motivo]`,
  `entrantes`/`turno`, `reclamar [<uuid>]`, `derivar a <especialidad> [motivo]`,
  `responder <texto>` (notifica al primario por 4 canales). En `/help`.
- **PWA sin dependencias** (`cepi-frontend`): `public/{manifest.webmanifest,sw.js,
  icon.svg}` + registro/Web Push en `src/pwa.js` + cola de envíos offline en
  `api.js` (`initOfflineQueue`/`flushOutbox`). Botones de turno + 🔔 en `Chat.vue`.
- **Fix genérico de `columnSyncService`**: ahora **reconcilia** el CHECK de un
  `select` cuando cambian sus `options` (drop+recreate si difiere, restaura el
  previo si falla) — antes solo lo creaba una vez. Beneficia a cualquier dominio.
- **Fix de permisos (latente)**: los roles clínicos solo tenían strings clínicos
  (`episode:*`), que **no** los usan las rutas genéricas de entidades (autorizan
  con `entity:<def>:record:{view_all,create,edit_all}`). Hasta ahora solo `admin`
  podía escribir. El seed 002 ahora otorga ese CRUD genérico a los 5 roles clínicos
  sobre paciente/episodio/diagnóstico/imagen, y la INSERT de bundles pasó a
  `ON CONFLICT DO UPDATE` (idempotente-actualizable).

**Verificación end-to-end (stack vivo, roles reales):** primario crea ficha →
`enviar caso` (`enviada`, reminder al turno) → residente ve bandeja + `reclamar`
(`en_triage`) → `derivar a dermatologia` (`derivada`, 2 reminders al círculo) →
especialista `responder` (`respondida` + recomendación). ✅

Tests: TodoERP backend **203 passed** (2 skipped; 1 preexistente roto
`cross_type_parent`) — +21 nuevos (groups, claim/assign, review→grupo, drivers).
cepi-bot **44 passed** (+5 regex de telemedicina). cepi-frontend build ✅.

---

## Sesión 2026-05-27 — permisos, identidad externa, reset y ERP

- **Permisos: un bundle por rol.** `medical-seed/002` ahora seedea un único
  registro de permiso por rol (`paciente_perms`, `medico_perms`,
  `supermedico_perms`, `admin_clinical_extras`, `guest_clinical`) con
  `data.permissions` como mapa plano; `flattenPermissionRows` lo expande. Se
  eliminaron los seeds granulares flotantes (`seeds/004,006,007,008`). De ~40
  registros a 7.
- **Tests se autolimpian.** `createTestUser` marca los permisos creados con
  `data._test=true`; `cleanupDatabase` + teardown global los purgan. La BD
  vuelve a 7 permisos tras correr la suite (antes acumulaba ~50).
- **Identidad externa única-nullable.** Migración 014: índices únicos parciales
  sobre `users.data->>'telegram_id'` y `whatsapp_phone`. `securityRouter` no
  persiste '' y mapea 23505 → 409; `/auth/external/link` → 409 en colisión.
  Campos Telegram ID / WhatsApp agregados a `UserEditor.vue`.
- **Bug reset corregido.** `reset-db.sh` cargaba `.env` del CWD → reseteaba la
  BD equivocada (`todoerp` en vez de `cepi`); ahora resuelve `.env` relativo al
  script. `reset-cepi.sh` reinicia el backend antes del seeder (shadow tables).
- **ERP fuera de ngrok.** Se quitó `VITE_BASE=/erp/` y el proxy `/erp`; el ERP
  sirve en raíz `/` en :5173 (acceso directo), arreglando las URLs no-root.

Tests: TodoERP backend 182 passed (1 preexistente roto: `cross_type_parent`,
`entity_episode.patient_id` NOT NULL); cepi-bot 39/39.

---

## Servicios corriendo (PM2 local)

| Nombre | Puerto | Estado | Notas |
|---|---|---|---|
| `todoerp-backend` | 3001 | ✅ | `CEPI_MEDICAL=1`: hooks médicos + clinicalImageProcessor |
| `todoerp-frontend` | 5173 | ✅ | admin TodoERP |
| `cepi-bot` | 3002 | ✅ | agente conversacional + MCP loop |
| `cepi-frontend` | 5174 | ✅ | UI médica de chat |
| `cepi-isic` | 8000 | ⚠️ disabled by default | Python FastAPI; `pm2 start … --only cepi-isic` tras `apt install python3-venv` |
| `postgres` (WSL) | 5432 | ✅ | con extensión pgvector |

---

## Plan refactor TodoERP — 10/10

| ID | Tema | Commit |
|---|---|---|
| R1 | shadow-sync trigger sobre `entities` | 4094bdc |
| R2 | cross-type FK en `entity_<slug>.parent_id` | e5044a1 |
| R3 | validación JSONB contra `entity_definitions.config` | 2248434 |
| R4 | redacción de PII en respuestas | 8dfaa8d |
| R5 | (Phase A) `entity_relationships.target_definition_id`+`local_key` | af0865a |
| R6 | lifecycle hooks por entity_definition | 7049347 |
| R7 | aislamiento de tests, sin prefijo TEST_ | fd0be39 |
| R8 | `roles.allow_grant_all` reemplaza el bypass por nombre | c13b370 |
| R9 | convención de routers (>300 LOC ⇒ split) | c87c82f |
| R10 | CORS_ORIGINS con globs | 9f006d9 |

R5 Phase B (rename de keys en data JSONB existente) — **superada por la migración JSONB→columnas**.

### Migración JSONB → columnas reales (completa)

Cada `entity_<slug>` tiene columnas tipadas derivadas de `entity_definitions.config.fields[]`. La columna `data JSONB` fue dropeada. Writers (`insertBusinessRecord`, `put.ts` rama business) escriben directo a columnas vía `planFieldsForEntity`/`mapDataToColumns`; readers reensamblan el shape `data` con `assembleDataFromRow`. `indexSyncService` indexa columnas reales. CHECK constraints generados para `select` con `options`. La API y el frontend no cambiaron. Implementación en `backend/src/services/columnSyncService.ts`.

---

## Fases del PAPER

### Fase 1 — capacidades genéricas en TodoERP

- [x] **1A reminders** (alerts/reminders subsystem, scheduler, channels)
- [x] **1B vector store** (pgvector, models_registry, vector_embeddings, entity_classifications)
- [x] **1C temporary permissions** (break-glass)
- [x] **1D request_review** (acción genérica de escalamiento)

### Fase 2 — MCP server de TodoERP

- [x] 28 tools genéricas
- [x] Test de generalidad (entidad no clínica "lead")
- [x] Wireado para que cepi-bot lo invoque por stdio

### Fase 3 — modelo clínico + datos ficticios

- [x] 9 entity_definitions (patient, episode, diagnosis, prescription, lab_order, clinical_image, bot_session, consent, icd10_code)
- [x] Roles paciente/medico/supermedico + matriz §13.1 (admin sin acceso clínico — D-1)
- [x] models_registry con 4 stubs ISIC + text-embed
- [x] form_configs + navs_configs
- [x] Seeder ficticio: 50 pacientes / 150 episodios / 80 dx / 120 imágenes / 240 clasificaciones / 200 reminders / 10 bot_sessions
- [x] CIE-10 dermatología (37 códigos)

### Fase 4 — agente conversacional

- [x] Cliente MCP del SDK
- [x] Loop de tool-use con LLM (StubLLMAdapter + DeepSeekLLMAdapter listos, env-driven)
- [x] Gestión de active_patient_id / active_episode_id por sesión
- [x] Persistencia bot_session vía entities.create
- [x] Frontend de chat con tool result rendering, file upload, pending action panel
- [x] PM2 ecosystem con los 4 servicios
- [x] Modo guest (CEPI_GUEST_API_KEY env)

### Fase 5 — captura clínica

- [x] Hook `episode_close_followup` (R6 first medical hook)
- [x] CIE-10 catálogo (data, no code)
- [x] Subida de imágenes → `clinical_image` con confirmación obligatoria
- [x] `nuevo episodio <motivo>` con auto-activate
- [x] `cerrar episodio <fecha> <motivo>` con fetch+merge para preservar data
- [x] PUT con validación parcial
- [x] `/help` autodescubrible
- [x] `ver paciente` / `ver episodio` shortcuts
- [x] `nota <texto>` + `ver chatter`
- [x] `signs PA=… FC=… T=…` (signos vitales con gate)
- [x] `diagnostico <CIE10> <descripción>` con gate
- [x] `resumen` de paciente
- [x] `exportar [anonimizado]` JSON download
- [x] Auditoría: chatter note tras cada confirmación (R6 + bot)
- [x] PII redaction outbound al LLM (PAPER §13.3.1)
- [ ] Slot filling guiado por LLM (deferido — requiere DEEPSEEK_API_KEY)

### Fase 6 — clasificación de imagen ISIC

- [x] Servicio Python `cepi-isic/` (FastAPI) — endpoints /embed, /classify/triage, /classify/multiclass — modo stub determinístico
- [x] Worker `clinicalImageProcessor` en TodoERP backend (poll cada 15s, batch 5, opt-in via CEPI_MEDICAL=1)
- [x] Test del worker con fetch stubbed
- [ ] Pesos reales (ResNet/EfficientNet sobre HAM10000) — el usuario los conecta cuando los tenga
- [ ] Política de escalación automática por confianza (D-Aux-1: nada se decide sin acción explícita del médico, así que la "escalación automática" es solo *visual highlight*; puede esperar)

### Fase 7 — modo paciente y portal — diferida a v1.5/v2

### Fase 8 — supermédico, dashboards

- [x] `/escalar a <user-uuid> <razón>` — escalación desde chat
- [x] `revisiones` shortcut — bandeja de episodios `en_revisión_solicitada`
- [x] `sugerir diagnostico` — clasificaciones ISIC → CIE-10 mapping
- [x] `casos similares` — vectors.search sobre la imagen activa
- [ ] Dashboards visuales agregados (TodoERP report_configs ya soporta esto, pendiente diseñar)
- [ ] Auditoría visual de tool-calls del bot

### Fase 9 — endurecimiento y despliegue

- [x] Rate limit en login (express-rate-limit, 200/15min en DEVELOP)
- [x] STAGE-aware: dev relaja, prod cierra
- [x] CORS configurable (R10)
- [x] Privilege escalation prevention (R8 + assertCanGrant)
- [ ] Pseudoanonimización de prompts antes de mandar al LLM (la idea: agente sin perm `pii:read:*` recibe data ya redactada por R4 al tirar tools)
- [ ] Política de retención implementada vía reminders nocturnos (plantilla SQL documentada en `docs/OPERATIONS.md` §5; falta el job nocturno)
- [x] Backup automatizado de DB (scripts `backup-db.sh` + `backup-db.ps1`; instrucciones de cron/Task Scheduler en `docs/OPERATIONS.md` §4)
- [x] Documentación operacional (`docs/OPERATIONS.md`: topología, env, backup/restore, retención, runbook, hardening checklist)

---

## Tests

| Paquete | Archivos | Pruebas |
|---|---|---|
| `TodoERP/backend` | 32 | 181/181 ✅ |
| `cepi-frontend` | — | — (Vue, sin tests todavía) |
| `cepi-bot` | 3 | 21/21 ✅ |

Cero regresiones acumuladas a lo largo del refactor + Fase 1-6.

---

## Comandos del bot disponibles

```
/help | tools

# Lectura
whoami | definitions
pacientes | episodios | diagnósticos | revisiones | recordatorios
buscar paciente <texto>
cie10 <texto>
ver paciente | ver episodio | ver chatter | resumen
casos similares | sugerir diagnostico

# Contexto
activar paciente <uuid> | salir paciente
activar episodio <uuid> | salir episodio

# Escritura (todas detrás del gate sí/no)
nuevo episodio <motivo>
cerrar episodio [YYYY-MM-DD] [motivo]
diagnostico <CIE10> <descripción>
signs PA=120/80 FC=70 T=36.5 …
/escalar a <user-uuid> <razón>
nota <texto>
📎 imagen → clinical_image

# Reminders (directos, sin gate)
completar reminder <uuid> [nota]
cancelar reminder <uuid>
snooze reminder <uuid> YYYY-MM-DD

# Export
exportar [anonimizado]   → descarga JSON
```

**UX del frontend:**
- Botones de atajos en el panel lateral (incluyendo `bandeja revisión`, `casos similares`, `sugerir dx`, `recordatorios`, `⤓ exportar`).
- Drag-and-drop de imágenes sobre el chat.
- Botones inline `activar` en filas de listas de pacientes/episodios.
- Panel **Pendiente** con Confirmar/Cancelar para todas las acciones gate.
- Sidebar muestra nombre del paciente activo + UUID corto.
- Hidrata sesión completa al recargar la página (turnos + activos + pending).

---

## Próximos pasos sugeridos

1. **Levantar `cepi-isic` real** (requiere `apt install python3-venv` con sudo).
2. **DeepSeek API key** y `CEPI_LLM_PROVIDER=deepseek` para que el agente entienda lenguaje natural en lugar de solo comandos. Slot filling guiado emerge gratis.
3. **Pseudoanonimización pull**: que el agente use un JWT/api-key sin `pii:read:*` y reciba data ya redactada al jalar tools. Listo para la integración con DeepSeek.
4. **Dashboards supermédico**: aprovechar `report_configs` + frontend admin. Es DATA, no code.
5. **R5 Phase B**: rename de keys en `data` JSONB en una ventana de mantenimiento.

---

## Sesión 2026-05-15 — Ficha clínica, formularios del bot, ICD-11

### Formularios del bot (`BotForm`)
- Componente `cepi-frontend/src/components/BotForm.vue`: tipos de campo
  `text`, `textarea`, `checkbox`, `radio`, `heading`, `entity_search`.
- Envío estructurado (`submit_mode: 'structured'`) → `{ form_id, data }`.
- `EntitySearchField.vue`: autocompletado con lazy-load contra `/api/entities`
  (usa `filter[<col>]` para columnas UUID; `q` no las matchea).
- Búsqueda de paciente y alta de paciente como formularios en el chat.
- **El formulario activo se persiste en `extracted_slots.active_form`** de la
  sesión → sobrevive recarga y cambio de conversación, hasta que se llena.

### Ficha clínica (consulta)
- Modos: "Atención a paciente" abre episodio + ficha; "Información paciente"
  enlaza al último episodio (no presencial).
- Ficha §3-§7 como formularios por sección; cada submit hace `entities.update`
  del episodio.
- Visor de ficha (`docs/ficha.html`, servido en `cepi-frontend/public/`):
  modal con paginador entre episodios, Guardar (→ bot → paciente+episodio),
  etiquetas en rojo si el valor cambió vs la ficha anterior, regiones del
  cuerpo como toggles (multi-opción `regiones_afectadas`).
- Semáforo diagnóstico A/B/C en la barra superior del chat (`diagnostico_letra`).

### LLM
- Adapter `cepi-bot/src/llmClaudeCli.ts`: usa el CLI `claude` como LLM.
  Activar con `CEPI_LLM_PROVIDER=claude` (seteado en `ecosystem.config.cjs`).

### Integración ICD-11 (OMS)
- `cepi-bot/src/icdWho.ts`: cliente WHO ICD-11 (OAuth2 client-credentials,
  token cacheado) + búsqueda MMS.
- Endpoint `GET /api/bot/icd/search?q=` (proxy; el `client_secret` queda
  server-side).
- Credenciales en `cepi-bot/.env` (gitignored): `WHO_ICD_CLIENT_ID`,
  `WHO_ICD_CLIENT_SECRET` — registrarse en https://icd.who.int/icdapi.
- Campo §5 Diagnóstico de la ficha: autocompletado contra ICD-11.

### Seeders (TodoERP/database/medical-seed)
- `004_medical_fake_data.sql`: fix de claves `patient_id`/`episode_id` planas
  + `medico_id` (faltaban → rompía el seed).
- `006_icd10_dermatology.sql`: reescrito a forma columnar (la tabla tipada no
  tiene columna `data`).
- `001` (definición episodio) + `005` (form): campos de la ficha §3-§7,
  `diagnostico`, `diagnostico_letra`, `regiones_afectadas`.

### Pendiente / notas
- `reset-cepi.sh` no limpia registros `entity_*` reales (no-SEED) creados desde
  la app — se acumulan; conviene un TRUNCATE explícito de tablas tipadas.
- Bot proactivo con formularios dinámicos generados por LLM: planificado,
  no implementado.

### Ficha atómica + riel de bookmarks (continuación)

- La ficha se recorre como **grupos atómicos**: un campo = un formulario =
  un bookmark (`FICHA_FIELD_DEFS` → `FICHA_GROUPS` en `flowV1.ts`).
- **Riel de bookmarks** (`Chat.vue`) en el borde izquierdo del chat:
  - Agrupados por categoría (Filiación, Antecedentes, Anamnesis, Examen
    físico, Diagnóstico, Estudios, Tratamiento) con headers separadores.
  - Efecto **lupa** tipo Dock: el cursor agranda hasta 5 elementos
    (centro ±2); posiciones cacheadas, sólo se redibuja al cambiar de centro.
  - En reposo: tabs chicos, anclados a la derecha, metidos fuera del borde
    izquierdo; ancho = largo del texto (`min-width` = ancho del riel).
  - Completado (campo con valor) → transparente.
- Formularios cerrados (radio): seleccionar envía y avanza, sin botón Guardar.
  Botón **Omitir** en cada formulario. Formularios abiertos conservan Guardar.
- Al abrir un bookmark, el formulario llega **prellenado** con el valor
  actual del campo (`fichaGroupFormFilled`).
- `fichaBookmarks` calcula "completado" leyendo el valor real en la entidad
  (paciente/episodio), no sólo lo enviado en la sesión.
- Campos del paciente (§1-§2) se guardan en el paciente; §3-§7 en el episodio.
- `picor` / `dolor` pasaron a picklist (leve/moderado/severo) — definición,
  form_config y `ficha.html` actualizados.
- Ficha §4.4: `gravedad_total` (E+I+F) autocalculado, mostrado como
  "<n> Leve|Moderada|Grave".
- §5 Diagnóstico: autocompletado contra ICD-11 (OMS) en `ficha.html`.

### Ficha por ítems numerados + ajustes

- Los grupos/bookmarks de la ficha son los ítems numerados (1.1, 1.2, 3.1…),
  no las secciones — 23 grupos (`FICHA_GROUP_SPEC` en `flowV1.ts`).
- Riel de bookmarks: anclado a la derecha, ancho = largo del texto, lupa
  tipo Dock (5 elementos, optimizada con translateX/translateY).
- Formularios cerrados de una sola pregunta auto-envían; los agrupados
  conservan Guardar.
- Al enviar un formulario, el turno del usuario en el chat queda con el
  resumen (label: valor de cada campo).
- §1.2: Fecha de nacimiento (date picker `type:date`); la edad se autocalcula.
- §5 Diagnóstico: campo `icd_search` — autocompletado ICD-11 (OMS) también
  en el formulario del bot (`IcdSearchField.vue`), no sólo en `ficha.html`.
- `picor`/`dolor` y `escolaridad_grado` → picklists.

### Correcciones de ficha, formularios y UX móvil

- **Bot — formularios**: `proximo_control_fecha` con date picker; al guardar la
  ficha completa (`ficha_save`) los campos vacíos ya no sobrescriben datos
  guardados; botón "Omitir" reubicado al lado opuesto de "Guardar" para evitar
  clicks accidentales.
- **Bot — flujo de ficha**: `firstIncompleteFichaGroup()` — al activar/crear un
  paciente el bot arranca en el primer grupo incompleto y omite los ya
  completos (no vuelve a pedir, p.ej., datos de contacto ya cargados).
- **Pacientes**: se crean con `title = "Nombre Apellidos"` (antes
  `paciente_<cédula>`), así son ubicables por nombre en TodoERP.
- **Riel de bookmarks (móvil)**: la lupa funciona con touchmove y selecciona al
  levantar el dedo; el chat deja padding por el riel; el nombre del paciente no
  queda bajo el botón burger.
- **Header**: el semáforo A/B/C se refresca tras guardar un formulario.
- **Ficha (`ficha.html`)**: edad autocalculada desde fecha de nacimiento;
  selects de Picor/Dolor con tipografía uniforme y opciones (+)/(++)/(+++);
  los labels en rojo muestran "Valor anterior: …" al hover.

### Ficha §4.6/§4.7/§8 — mapa corporal e imágenes

- **§4.6 Regiones afectadas**: nuevo grupo `g_4_6` y nuevo tipo de campo
  `body_map`. El componente `BodyMapField.vue` replica las dos siluetas de
  `ficha.html` (`cuerpos.png` + 36 regiones, óvalos clicables); guarda
  `regiones_afectadas` como CSV de claves de región.
- **§4.7 Imágenes Lesión**: grupo `g_4_7`, tipo de campo `image_upload`
  (`ImageUploadField.vue`, subida múltiple vía `/api/attachments`). Al enviar,
  cada imagen pasa por `cepi-isic POST /inspect` (`imageInspect.ts`):
  - chequeo real de calidad — resolución (≥480px lado menor) e iluminación
    (brillo medio 40–220/255); las inadecuadas se omiten y el motivo se
    informa en el chat.
  - detección de rostro (OpenCV haar cascade) → el `clinical_image` se marca
    `privada: true` (campo nuevo en el `entity_definition`).
  - las adecuadas se crean con `embedding_status: 'pending'`; el worker
    `clinicalImageProcessor` ya existente las clasifica vía ISIC. Vinculadas a
    episodio y paciente.
- **§8 Imágenes Consentimiento**: grupo `g_8`; almacena cada imagen como un
  registro `consent` (`tipo: 'imagen_clinica'`) vinculado al paciente.
- Ambos grupos escriben los registros **directo al enviar el formulario**,
  como el resto de la ficha — sin confirmation gate: el envío del formulario
  ya es la acción explícita del usuario (no es una escritura inferida por el
  agente). El gate sí/no queda sólo para escrituras que el agente infiere de
  texto libre o de un comando.
- **cepi-isic**: nuevo endpoint real (no stub) `POST /inspect` — Pillow para
  dimensiones/brillo, OpenCV para rostro; dependencia `opencv-python-headless`.

### Auto-omisión de formularios ya completos

- `nextIncompleteFichaGroupId()` / `fichaGroupIsComplete()` en `flowV1.ts`: al
  avanzar la ficha (tras guardar u "Omitir") se salta a la siguiente sección
  **sin valor**, no a la siguiente en orden.
- Al reanudar una sesión (`GET /api/bot/session/:id`), si el formulario
  persistido apunta a un grupo ya completo (p.ej. `fecha_nac` cargada desde
  otra sesión sobre el mismo paciente), se auto-omite hacia el siguiente
  incompleto; si no, se refrescan sus valores desde la entidad.

### Galería de imágenes y resultados ISIC en el chat

- **Botón "Mostrar Imágenes"** junto a "Mostrar ficha" (`Chat.vue`): abre
  `ImageGallery.vue`, una grilla con las imágenes clínicas del episodio; cada
  celda muestra la imagen y, en el pie, los resultados de cada modelo.
- **Endpoint** `GET /api/bot/episode-images?episode_id=…` (cepi-bot) +
  helper `episodeImages.ts` (`listEpisodeImagesWithClassifications`).
- **Comando `mostrar resultados imagen`**: lista las clasificaciones de las
  imágenes del episodio. Acepta ids de `clinical_image` al final para
  scopearlo a imágenes puntuales. Emite un marcador `[img:<attachment_id>]`
  por imagen — `MessageContent.vue` lo expande a miniatura inline en el chat
  (descarga autenticada → blob URL). No emite turno `tool`.
- **Auto-resultado tras §4.7**: la respuesta del grupo de imágenes lleva
  `await_isic` con los ids de los `clinical_image` recién creados; el frontend
  hace polling de cepi-isic (cada 5 s, hasta ~2 min) y, cuando esas imágenes
  dejan de estar `pending`, auto-envía `mostrar resultados imagen <ids>` —
  el resultado aparece solo en el chat, scopeado a las imágenes cargadas.
- **Filtro por columna UUID**: listar imágenes por episodio usa
  `filter: { episode_id }` (match exacto de columna), no `search` (texto
  libre, que no matchea UUIDs). Corregido también en `sugerir diagnostico`
  y `casos similares`.

### Sección BLINK (cribado de malignidad)

- Nueva sección **BLINK** en la ficha, **antes de §4 Examen físico**: grupo
  `g_blink` en `FICHA_GROUP_SPEC`, bookmark con label **"BLINK"**.
- Un **único formulario** con las 5 preguntas del algoritmo BLINK
  (B, L, I, N/C, K) — radios Sí/No.
- **Resultado autocalculado** al enviar: `blink_total` = suma de L+I+N/C+K
  (1 pt c/u); `blink_resultado` = "Benigna evidente — no precisa más
  estudios" si B=Sí, o "Sugiere malignidad (n/4) — biopsia" si total ≥2,
  o "Sugiere benignidad (n/4)" si total ≤1.
- Se almacena en el episodio: 7 campos nuevos en el `entity_definition`
  `episode` (`blink_benigna`, `blink_lonely`, `blink_irregular`,
  `blink_nervios_cambios`, `blink_known_clues`, `blink_total`,
  `blink_resultado`) — `001_medical_definitions.sql`.
- El **puntaje BLINK** se muestra en la cabecera del chat junto al semáforo
  Dx (badge "Blink n"); se pinta rojo cuando ≥2. Si BLINK aún no se completó
  muestra "Blink -" (se distingue de un 0 real vía `blink_resultado`).
