# Respuesta a App Review — Guideline 2.1 Information Needed (iOS 1.0 build 11)

Rechazo del 2026-10-09 (submission `8c58c07f-90d1-4115-8c67-e21fd0b09976`). Apple pide seis
puntos. El punto 1 es un screen recording en iPhone físico. Los puntos 2 a 6 van abajo, en inglés, como
se pegaron en "Reply to App Review" y, resumidos, en el campo **Notes** de App Review
Information. El estado del envío está al final.

Las credenciales se copian del `.env` local
(`CEPI_REVISOR_*`); este archivo vive en un repo público y no las contiene.

---

## A. Reply to App Review (pegar completo; adjuntar el video)

Hello, thank you for the review. Below is the requested information. The screen recording
(point 1) is attached.

**1. Screen recording**
Two clips attached. Recorded on a physical iPhone running the latest iOS. It starts at app launch and
shows: login with the demo account, the patient list, creating a patient, a chat turn with the
clinical assistant, filling a section of the medical record, the record and image sections,
and referring a case to a specialist circle. In that clip the account deletion dialog is shown
and cancelled to keep the demo account. A second clip shows the complete account deletion with
a disposable account: Account menu, "Eliminar cuenta", confirmation, return to the login
screen, and a failed sign-in with the deleted credentials. The app has no paid content, no in-app purchases and no public user-generated
content: everything written in the app is clinical documentation visible only to the licensed
physicians who belong to the same organization.

**2. Purpose and target audience**
CEPI Telemedicina is the internal telemedicine tool of CEPI (Centro de la Piel), a dermatology
center in Ecuador. It is used only by physicians who work with CEPI: primary-care physicians in
remote locations capture a dermatology case (photos, history, structured medical record) and
refer it to CEPI's dermatologists, who review it, answer, and close the case. The problem it
solves is access to dermatology specialists for patients who live far from the center. The app
is not for patients and not for the general public. Accounts are created by invitation or
self-registration, but every account must be approved by a CEPI administrator before it can see
any data. Distribution is restricted to Ecuador.

**3. Setup and access to the main features**
No setup is needed. Sign in with email and password on the first screen (do not use
"Continuar con Google" for the demo account):

- Primary physician (captures and refers cases): `<CEPI_REVISOR_EMAIL>` / `<CEPI_REVISOR_PASSWORD>`
- Specialist (receives referrals), for the referral flow: `<CEPI_REVISOR_COLEGA_EMAIL>` / `<CEPI_REVISOR_COLEGA_PASSWORD>`

Both accounts belong to a sandbox organization ("Testing") that contains only fictitious
patients; they cannot reach any real patient data. Main features, in order: patient list and
search → "Nuevo paciente" → the patient thread (three sections, swipe between them: Chat,
Ficha/medical record, Imágenes/images) → "Derivar" to refer the case to a specialist circle →
Account menu: sign out, delete account. Sample files are not required; photos can be taken with
the camera or chosen from the library.

**4. External services used for core functionality**
- Backend hosted by CEPI on Amazon Web Services (EC2 instance in the United States), API at
  `https://telemedicina.cepi.ec`. Patient data is stored only there.
- Google OAuth 2.0 ("Continuar con Google"): optional sign-in with a Google account. Email and
  password sign-in is also available and is what the demo account uses.
- DeepSeek (LLM API): powers the clinical assistant in the Chat section. Personally
  identifiable fields are redacted before any text is sent to the model.
- Brevo (transactional email): account invitations and notifications.
No payment processor, no advertising SDK, no analytics or tracking SDK.

**5. Regional differences**
None. The app is only available in Ecuador and functions identically everywhere. The
interface is in Spanish.

**6. Regulated industry**
The app is published by Cempiel Cia. Ltda., the legal entity that operates the dermatology
center "CEPI Centro de la Piel" in Quito, Ecuador. Attached is its public record in Ecuador's
tax authority registry (SRI, Servicio de Rentas Internas), which anyone can verify at
https://srienlinea.sri.gob.ec (Consulta de RUC):

- Taxpayer ID (RUC): 1792199816001. Legal name: CEMPIEL CIA. LTDA. Status: ACTIVE.
- Registered main activity: "Consulta y tratamiento por médicos generales y especialistas"
  (consultation and treatment by general and specialist physicians).
- Registered establishment: "CEPI CENTRO DE LA PIEL", Veracruz N34-38 y Av. América, Quito.
  Status: OPEN. In operation since 2009-05-22.

The app is used by CEPI's own licensed physicians as a clinical documentation and referral
tool. It does not offer medical services to the public and contains no third-party protected
material. It follows Ecuador's personal data protection law (LOPDP, 2021); the privacy policy
is at `https://telemedicina.cepi.ec/privacidad.html`.

Thank you.

---

## B. Notes (App Review Information) — versión corta para dejar guardada

CEPI Telemedicina is the internal telemedicine tool of CEPI, a dermatology center in Ecuador.
Only CEPI physicians use it: a primary-care physician captures a dermatology case (photos,
medical record) and refers it to CEPI dermatologists. Not for patients. Every account must be
approved by a CEPI administrator. Ecuador only, Spanish UI, no purchases, no ads, no tracking.

Demo accounts (sandbox organization with fictitious patients only; sign in with email and
password, not Google):
- Primary physician: `<CEPI_REVISOR_EMAIL>` / `<CEPI_REVISOR_PASSWORD>`
- Specialist: `<CEPI_REVISOR_COLEGA_EMAIL>` / `<CEPI_REVISOR_COLEGA_PASSWORD>`

Flow: patient list → "Nuevo paciente" → thread with Chat / Ficha / Imágenes (swipe) →
"Derivar" to refer → Account menu → "Eliminar cuenta" deletes the account in-app.

External services: own backend on AWS (telemedicina.cepi.ec), Google OAuth (optional sign-in),
DeepSeek LLM API (clinical assistant, PII redacted), Brevo (email). Privacy policy:
https://telemedicina.cepi.ec/privacidad.html. Regulatory: CEPI (Cempiel Cia. Ltda.) is a
licensed dermatology center in Ecuador; the app is its internal tool.

---

## Estado (2026-10-10)

- **Respuesta enviada** en "Reply to App Review" a las 11:36, con tres adjuntos: el recorrido
  (2 min 43 s), el borrado real de cuenta (1 min) y el registro del SRI de Cempiel en PDF. El
  campo admite 4000 caracteres: el texto enviado es la sección A abreviada, con los seis puntos.
- **Notes de App Review Information guardadas**: a las notas del 2026-10-08 se les agregó un
  anexo con propósito, segunda cuenta demo, servicios externos, regiones y el RUC.
- **Reenviada a revisión** el 2026-10-10: el usuario presionó "Resubmit to App Review".
- Los clips se grabaron con XCTest en el iPhone 11 físico contra producción. El borrado usó
  una cuenta desechable de la sandbox (`revisor.borrar.26ba7d@cepi.ec`), que ya no existe.
- cepi.ec no publica el permiso de funcionamiento y el portal de ACESS no respondía. Si Apple
  pide más, el documento sanitario propiamente dicho es el permiso de ACESS.
- Los dos pacientes de las grabaciones en la sandbox de prod ("Revisión Apple 29A2" y
  "Revisión Apple 1327") se dieron de baja el 2026-10-10 (borrado lógico, `active = false`).
- El iPhone de pruebas volvió al build 11 de TestFlight. Para automatizarlo con XCTest hace
  falta Ajustes > Desarrollador > "Enable UI Automation"; apagado, el test muere con
  "Timed out while enabling automation mode". Los tests de la grabación no están en el repo.
