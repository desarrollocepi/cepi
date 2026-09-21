# Apps nativas: Android (Capacitor) + iOS (SwiftUI)

> **iOS no se empaqueta desde acá.** iPhone/iPad es una app nativa en SwiftUI,
> `cepi-ios/` (decisión y plan en PAPER §24). Este documento es para Android; lo de
> Firebase, APNs y cuentas del final vale para las dos.
>
> **Android también pasa a nativo:** `cepi-android/` (Kotlin + Compose, PAPER §25). Esta APK
> Capacitor sigue publicada hasta que la nativa la reemplace en Play (§25.7).

La app web (`cepi-frontend`, Vue 3 + Vite, PWA) se empaqueta como **app Android**
con **Capacitor 8**. Estrategia: **híbrido** — el build web viaja dentro de la app
y se actualiza **OTA** (over-the-air) sin re-subir a las tiendas para cambios de
UI; **push nativo** vía **FCM (Android) + APNs (iOS)**.

- appId / bundle id: **`ec.cepi.telemedicina`** (debe coincidir en Firebase + Apple).
- appName: **CEPI Telemedicina**.
- La app nativa llama al backend real (`https://telemedicina.cepi.ec`) — un
  interceptor reescribe `/api` → absoluto (`src/native/index.js`). El web sigue
  usando rutas relativas + service worker (VAPID) sin cambios.

## Requisitos de build

| | Android | iOS |
|---|---|---|
| Máquina | Linux/Mac (este repo compila en Linux) | **Mac + Xcode 26+** (obligatorio) — proyecto en `cepi-ios/` |
| Toolchain | **JDK 21** (Capacitor 8 lo exige), Android SDK (compileSdk 36), gradle wrapper | Xcode (SwiftUI, sin CocoaPods) |

⚠️ **JDK 21**: el build de Android falla con JDK 17 (`invalid source release: 21`).
Usá `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64` (o el JBR de Android Studio).

## Android — build (ya verificado en Linux)

```bash
cd cepi-frontend
export ANDROID_HOME=$HOME/Android/Sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64

# copiar el placeholder para poder compilar sin Firebase (push no funciona aún):
cp android/app/google-services.json.example android/app/google-services.json

npm run android:apk          # → android/app/build/outputs/apk/debug/app-debug.apk (~9 MB)
# release firmado (Play):
npm run android:aab          # → android/app/build/outputs/bundle/release/app-release.aab
```

**Firma release** (una vez): generá un keystore y `android/keystore.properties`
(git-ignored), y agregá `signingConfigs.release` en `android/app/build.gradle`.
```bash
keytool -genkey -v -keystore android/cepi-release.keystore -alias cepi -keyalg RSA -keysize 2048 -validity 10000
```
`android/keystore.properties`:
```
storeFile=cepi-release.keystore
storePassword=…
keyAlias=cepi
keyPassword=…
```
Guardá el keystore + passwords en un gestor: **si lo perdés, no podés publicar updates** (salvo con Play App Signing).

## iOS — app nativa, no Capacitor

No correr `npx cap add ios`: iPhone/iPad es `cepi-ios/` (SwiftUI, PAPER §24), con el mismo
bundle id `ec.cepi.telemedicina` y el mismo backend de push. En su Xcode: agregar
`GoogleService-Info.plist` al target; habilitar **Push Notifications** + **Background
Modes → Remote notifications**; Archive → subir con Organizer/Transporter.

## Push nativo (FCM/APNs)

- **Cliente**: `src/native/push.js` pide permiso, obtiene el token FCM y lo
  registra en `POST /api/push/device-token`. Se dispara tras login (`cepi:auth`)
  y se limpia en logout (`cepi:logout`).
- **Backend**: driver `native_push` (`TodoERP/backend/src/services/channels/nativePush.ts`)
  envía por FCM (`firebase-admin`, `sendEachForMulticast`) a los `device_tokens`
  del dueño del reminder. Las derivaciones ya incluyen `native_push` en sus canales.
  Degrada a `skipped` si no hay credenciales (no rompe). Web Push (VAPID) sigue igual.
- Tabla `device_tokens`: migración **017**.

## OTA (auto-update del layer web, self-hosted)

Config en `capacitor.config.ts` (`CapacitorUpdater.autoUpdate + updateUrl`). En cada
arranque la app consulta `GET /api/ota/latest` (backend `otaRouter`, sirve
`OTA_MANIFEST_PATH`, default `/opt/cepi/ota/latest.json`). Release de un update web:
```bash
cd cepi-frontend && npm run build
VER=1.0.1
(cd dist && zip -r /opt/cepi/ota/cepi-$VER.zip .)
cat > /opt/cepi/ota/latest.json <<JSON
{ "version": "$VER", "url": "https://telemedicina.cepi.ec/ota/cepi-$VER.zip" }
JSON
# servir /opt/cepi/ota/ estático por nginx en /ota/
```
⚠️ OTA solo para **fixes/UI dentro del alcance revisado** — cambios de propósito van por las tiendas (Apple 2.5.2 / Play).

---

# PASOS EXTERNOS que dependen de vos (no se pueden automatizar acá)

**Aclaración de credenciales** (se confunden):
- `client_secret_…apps.googleusercontent.com.json` = **OAuth de Google** (el login con Google que ya usa la app). **NO** es push.
- `google-services.json` = config **Android** de Firebase (para el build).
- `GoogleService-Info.plist` = config **iOS** de Firebase.
- `…firebase-adminsdk-….json` = **service account** (para que el **backend** envíe push).

**Firebase** (una vez): crear/usar un proyecto → agregar app Android (`ec.cepi.telemedicina`)
→ bajar `google-services.json` a `cepi-frontend/android/app/` (reemplaza el placeholder);
agregar app iOS → bajar `GoogleService-Info.plist`; **Configuración → Cuentas de servicio →
Generar clave privada** → poner ese JSON en el VPS (`/opt/cepi/secrets/fcm-service-account.json`,
chmod 600) y setear en el `.env` del backend: `GOOGLE_APPLICATION_CREDENTIALS=/opt/cepi/secrets/fcm-service-account.json`.

**Apple / APNs**: cuenta Apple Developer (USD 99/año); Keys → crear **APNs Auth Key (.p8)**
(anotar Key ID + Team ID) → subirla en **Firebase → Cloud Messaging → Apple app config**
(el .p8 queda en Firebase; iOS va FCM→APNs). App ID + provisioning + Mac con Xcode para el archive.

**Google Play**: cuenta Play Console (USD 25); crear app, **Data Safety** + **declaración de
apps de salud** (telemedicina), opt-in a **Play App Signing**. Guardar el keystore.

**Assets de tienda** (no los genera el tooling): Play feature graphic 1024×500, screenshots de
teléfono; iOS screenshots 6.9" (1320×2868). Privacy policy URL + disclaimer médico.

**OTA hosting**: en el VPS servir `/ota/` estático + el endpoint `/api/ota/latest` (ya existe).
