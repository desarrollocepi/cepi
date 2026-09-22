# Asistente Médico Conversacional sobre TodoERP

**Documento de proyecto — borrador 0.1**
**Fecha:** 2026-05-06
**Repositorio raíz:** `D:\cepi`
**Autor:** Equipo CEPI / Seyacat

---

## 1. Resumen ejecutivo

Construir un **asistente médico conversacional** que reduzca al mínimo la fricción de captura de datos clínicos. El médico habla con el bot durante (o después de) la consulta; el bot extrae información estructurada de manera incremental y la persiste en una base de datos clínica, sin pedirle nunca al médico que llene un formulario largo de una sola vez.

La plataforma de gestión y persistencia es **TodoERP** (sistema polimórfico ya existente, basado en `entity_definitions` + `entities` con `data` JSONB). El bot **no accede a la base de datos directamente**: TodoERP expone sus capacidades como un **servidor MCP** (Model Context Protocol), y el agente conversacional las consume como *tools*. Cualquier capacidad que falte se añade como nueva *tool* MCP.

Hay cinco roles: **guest, paciente, médico, supermédico, admin**. Cada rol determina qué *tools* del MCP puede invocar el agente y qué datos le devuelven.

---

## 2. Contexto y problema

### 2.1 Contexto

CEPI Centro de la Piel (cepi.ec) ya tiene un chatbot público de orientación dermatológica (`backend/server.js` actual, basado en DeepSeek + un árbol de decisión hardcodeado en `tree.js`). Es informativo, no clínico, y no persiste nada.

En paralelo existe **TodoERP** (`D:\cepi\TodoERP`), un ERP polimórfico con autenticación, permisos finos, formularios dinámicos (`form_configs`), adjuntos, chatter (feed de cambios + notas), accounting y traducciones. Está pensado para modelar entidades de cualquier tipo sin migraciones por cada dominio nuevo.

### 2.2 Problema

La carga de datos clínicos es la principal fuente de fricción en una consulta:

- Formularios extensos exigen que el médico interrumpa la atención para tipear.
- La estructura rígida no se adapta al ritmo natural del diálogo médico-paciente.
- Los datos relevantes para diagnóstico (anamnesis, signos, antecedentes, tratamientos previos) suelen aparecer dispersos en notas libres y no son consultables.
- El paciente repite información que ya dio en visitas anteriores.

### 2.3 Hipótesis

> Un agente conversacional con contexto del paciente activo, capaz de extraer y persistir slots clínicos de manera incremental sobre un modelo polimórfico flexible, puede reducir el tiempo de carga, mejorar la calidad estructurada del dato y evitar redundancia, **sin imponer un esquema rígido al médico**.

---

## 3. Objetivos

### 3.1 Objetivo general

Diseñar e implementar un asistente médico conversacional que use TodoERP como sistema de persistencia y gestión administrativa, exponiendo su funcionalidad vía MCP, con captura progresiva de datos clínicos de baja fricción.

### 3.2 Objetivos específicos

1. Modelar el dominio clínico (paciente, episodio, diagnóstico, examen, prescripción, imagen) sobre el sistema polimórfico de TodoERP.
2. Implementar un **servidor MCP** dentro de TodoERP que exponga lectura, escritura, búsqueda, adjuntos y consulta de definiciones como *tools* tipadas.
3. Construir un **agente conversacional** (LLM con tool-use) que mantenga contexto de paciente activo, haga *slot filling* incremental y persista por *tools* MCP.
4. Definir y aplicar la matriz de permisos para los cinco roles (guest, paciente, médico, supermédico, admin).
5. Cumplir con la **Ley Orgánica de Protección de Datos Personales del Ecuador (LOPDP)** y buenas prácticas equivalentes a HIPAA.
6. Dejar trazabilidad completa de toda interacción del bot (qué *tool* invocó, con qué argumentos, qué devolvió) usando el módulo Chatter ya existente.

---

## 4. Alcance

### 4.1 Dentro del alcance (v1)

- Especialidad piloto: **dermatología** (alineado con CEPI), extensible.
- Roles: guest, paciente, médico, supermédico, admin (los cinco mencionados).
- Idiomas: **español** primero; inglés a través del módulo de traducciones existente.
- Captura por chat de: motivo de consulta, anamnesis dirigida, exploración (descripción + fotos), diagnóstico presuntivo, plan, prescripción libre.
- Subida de imágenes clínicas vinculadas al episodio (módulo de attachments existente).
- Historial completo del paciente con vista cronológica (Chatter + lista de episodios).
- Auditoría: cada acción del bot deja entrada en Chatter del paciente / episodio.

### 4.2 Fuera del alcance (v1)

- **Diagnóstico autónomo**: el bot **nunca** emite un diagnóstico definitivo. Sugiere y deja al médico la decisión.
- Integración con sistemas externos (HL7/FHIR, laboratorios reales, e-prescripción legal).
- Análisis de imagen por IA (clasificador dermatológico). Las fotos se almacenan; no se procesan automáticamente en v1.
- Telemedicina con video en tiempo real.
- Facturación clínica (pero TodoERP ya tiene módulo accounting, queda como extensión).

---

## 5. Stakeholders y roles

| Rol | Quién es | UI que usa | Qué hace en el sistema |
|---|---|---|---|
| **Guest** | Visitante anónimo | Frontend médico (modo público, sin login) | Bot de orientación, formularios públicos, pre-registro. Sin persistencia salvo la solicitud. |
| **Paciente** | Persona registrada (modo opcional v1.5) | Frontend médico (login con magic link) | Conversa con el bot para autollenar antecedentes, ve su propia ficha y consultas pasadas, mensajería con su médico. |
| **Médico** | Profesional asignado | Frontend médico (login email+password) | Conversa con el bot durante/después de consulta para registrar episodio; ve y edita las fichas de **sus** pacientes; sube imágenes; firma diagnóstico presuntivo. Escala casos a colegas (CU-8). |
| **Supermédico** | Médico senior / supervisor | Frontend médico (login email+password) | Lee toda la base clínica; revisa diagnósticos; aprueba permisos temporales y solicitudes de revisión; dashboards agregados; auditoría clínica. |
| **Admin** | Operador del sistema | **TodoERP** (frontend admin Vue 3) | Gestión de usuarios, roles, configuraciones de formularios, traducciones, modelos del `models_registry`, auditoría técnica. **No** lee datos clínicos por defecto (D-1); usa break-glass (§13.5) para acceso ad-hoc. |

> **D-Aux-4:** TodoERP es exclusivamente para el admin. Médicos, supermédicos, pacientes y guests **no usan TodoERP** — todos operan en el frontend médico unificado (`D:\cepi\frontend`).

---

## 6. Arquitectura general

```
┌─────────────────────────────┐    ┌──────────────────────────────────────┐
│  Admin                      │    │  Guest / Paciente / Médico /         │
│  → TodoERP frontend (Vue 3) │    │  Supermédico                         │
│    Gestión de usuarios,     │    │  → Frontend médico unificado         │
│    forms, permisos, modelos │    │    (D:\cepi\frontend)                │
└──────────────┬──────────────┘    │    Chat + ficha paciente + episodios │
               │ REST              │    + galería + bandeja revisión      │
               │                   └──────────────────┬───────────────────┘
               │                                      │ HTTP / SSE
               ▼                                      ▼
┌──────────────────────────────┐    ┌────────────────────────────────────┐
│   TodoERP Backend            │    │    Agente médico (cepi-bot)        │
│   (Express + JWT)            │    │    Node.js, tool-use con Claude    │
│   REST CRUD, auth, permisos  │    │    Cliente MCP                     │
│   pg-boss, Brevo, vectores   │    │    Redacción PII en lectura (D-4)  │
└──────────────┬───────────────┘    └─────────────┬──────────────────────┘
               │                                  │ MCP (stdio/HTTP)
               │  acceso compartido               ▼
               │                    ┌──────────────────────────────────┐
               │                    │   TodoERP MCP Server (NUEVO)     │
               │                    │   Tools genéricas:               │
               │                    │   entities.* / relations.* /     │
               │                    │   reminders.* / vectors.* /      │
               │                    │   classifications.* / chatter.* /│
               │                    │   permissions.* / attachments.*  │
               └────────────────────┴──────────────┬───────────────────┘
                                                   ▼
                                            ┌─────────────────┐
                                            │   PostgreSQL    │
                                            │   + pgvector    │
                                            └────────┬────────┘
                                                     │
                              ┌──────────────────────┴──────────────────┐
                              ▼                                         ▼
                  ┌─────────────────────────┐         ┌─────────────────────────┐
                  │  Servicio Python ISIC   │         │   Brevo (email)         │
                  │  (FastAPI, GPU/CPU)     │         │   pg-boss (cola)        │
                  │  /embed, /classify      │         │                         │
                  └─────────────────────────┘         └─────────────────────────┘
```

### Cuatro procesos lógicos + servicios externos

1. **TodoERP Backend** (`TodoERP/backend`): API REST, autenticación, permisos, scheduler de recordatorios, worker de clasificaciones, integración con Brevo. Genérico — no contiene vocabulario médico.
2. **TodoERP MCP Server** (`TodoERP/mcp/`): expone capacidades genéricas de TodoERP como *tools* MCP. Reutiliza servicios y middleware de auth/permisos del backend.
3. **Agente médico (cepi-bot)** (`cepi-bot/`, refactor de `backend/` actual): orquesta el LLM (Claude), gestiona contexto de conversación, llama *tools* MCP, **redacta PII en lectura**.
4. **Servicio Python ISIC** (`medical-models/`): FastAPI + modelo dermatológico local (HAM10000), GPU si disponible, fallback CPU. Procesa imágenes en background vía cola pg-boss.

Servicios externos: **Brevo** (email transaccional para magic link y recordatorios), **Anthropic Claude API** (LLM principal).

### ¿Por qué MCP?

- **Reutilización**: cualquier cliente MCP (Claude Desktop, Claude Code, otros agentes futuros) puede operar TodoERP con las mismas *tools*.
- **Aislamiento**: el bot no necesita credenciales de DB; toda autorización pasa por el MCP, que reutiliza la matriz de permisos de TodoERP.
- **Tipado**: cada *tool* MCP declara su *schema* JSON, lo que el LLM aprovecha para llamadas correctas y validación.
- **Auditoría centralizada**: cada *tool call* se loguea en Chatter con autor, argumentos y resultado.

---

## 7. Reutilización de TodoERP y principio de generalidad

### 7.1 Principio de generalidad (no negociable)

**TodoERP es un ERP genérico**. Todo lo que se le añada en este proyecto debe mantener ese carácter. El conocimiento del dominio médico **no vive** en el código de TodoERP ni en las *tools* del MCP. Vive en:

- Las `entity_definitions` y sus `form_configs` (datos de configuración, no código).
- Los scripts de seed médicos (`004_medical_seed.sql`).
- El agente médico (`cepi-bot`), que traduce intenciones clínicas a operaciones genéricas.

TodoERP **no debe tener** tablas, columnas, rutas REST ni *tools* MCP cuyos nombres o lógica presupongan "paciente", "episodio", "diagnóstico". Cualquier feature funcional añadida (alertas, vectores, clasificación de imágenes) se diseña como **capacidad transversal** del ERP, reutilizable por cualquier dominio futuro (logística, RRHH, educación, etc.).

Operativamente: si una feature se nombra `medical_*` o se documenta como "para clínicas", está mal modelada. Hay que rediseñarla en abstracto.

### 7.2 Lo que se reutiliza tal cual

| Capacidad TodoERP | Componente | Uso del lado del agente médico |
|---|---|---|
| Tablas polimórficas | `entity_definitions`, `entities`, `data JSONB` | Cada entidad clínica es una entity_definition; cada registro va en `entities` |
| Formularios dinámicos | `form_configs` + `DynamicFormRenderer.vue` | Vistas administrativas de paciente, episodio, prescripción |
| Permisos resource:action | `roles`, `permissions`, `role_permissions` + `hasPermission` middleware | Matriz médica (ver §13), construida con permisos genéricos |
| Adjuntos con dedup SHA256 | `attachments` + `AttachmentsGallery.vue` | Fotos clínicas, informes |
| Chatter (feed de cambios + notas) | `chatter` + `Chatter.vue` | Trazabilidad clínica + auditoría del bot |
| Relaciones entre entidades | `entity_relationships` | Paciente↔Episodio, Episodio↔Diagnóstico, Médico↔Paciente |
| Índices por campo | `indexSyncService` | Búsqueda rápida por cédula, email, fecha |
| Traducciones dinámicas | `translations` table + i18n | Soporte multi-idioma del UI |
| Formularios públicos (guest) | `publicFormsRouter` + API keys | Autoatención del rol guest |

### 7.3 Capacidades nuevas y genéricas que TodoERP debe ganar

Tres bloques de funcionalidad que actualmente faltan en TodoERP. Se diseñan **sin ninguna referencia médica**, y luego el agente las usa para casos clínicos.

#### 7.3.1 Servidor MCP de TodoERP (genérico)

Detallado en §8. Expone CRUD, búsqueda, relaciones, adjuntos, chatter, alertas y vectores como *tools* sobre cualquier `entity_definition`.

#### 7.3.2 Sistema de alertas y recordatorios (genérico)

Detallado en §9. Programador de eventos asociables a cualquier `entities.id` con disparadores temporales o por condición; canales de entrega plugables (in-app, email, webhook, push); recurrencia opcional; cierre/cancelación con resultado.

Casos de uso médicos típicos (no exclusivos):
- Recordar al paciente una toma de medicación.
- Recordar al médico revisar control en N días.
- Repreguntar al paciente por evolución 7 días después del episodio.
- Avisar al supermédico si hay diagnósticos sin aprobar.

Casos de uso no médicos (pruebas de generalidad):
- Recordar vencimiento de factura, renovación de suscripción, cumpleaños de cliente, renovación de contrato.

#### 7.3.3 Vector store + clasificación de entidades (genérico)

Detallado en §10. Extensión `pgvector` en Postgres; tablas `vector_embeddings` y `entity_classifications` referenciables desde cualquier entidad; *tools* MCP de upsert, k-NN, set/get classification, vinculación con un `model_id` declarado en una nueva tabla `models_registry`.

Casos de uso médicos típicos:
- Embeddings de imágenes de lesiones para "casos similares".
- Clasificaciones por modelos ISIC (ver §10).

Casos de uso no médicos:
- Búsqueda semántica de documentos, productos, candidatos a un puesto, etc.

#### 7.3.4 Permisos temporales (break-glass) — capacidad genérica

Detallado en §13.5. Tabla `temporary_permissions` que extiende el sistema de permisos de TodoERP con concesiones puntuales con TTL, justificación obligatoria, audit en chatter. Dos modos: self-serve con TTL ≤ 1h y notificación post-facto, o solicitud aprobada por un supervisor.

Casos de uso médicos típicos:
- Admin necesita inspeccionar un episodio para resolver un bug → break-glass 1h, justificación visible al supermédico.
- Médico necesita ver un paciente de otro colega para una interconsulta puntual.

Casos de uso no médicos:
- Contador necesita ver una factura confidencial que normalmente no tiene permiso.
- Soporte necesita ver el ticket de un cliente.

#### 7.3.5 Acción genérica de revisión (escalamiento)

Detallado en §13.6. Tool `entities.request_review(entity_id, { reviewers[], reason, due_at? })` para que un usuario solicite que otros revisen una entidad. Crea recordatorios + nota de chatter + cambio de estado.

Casos de uso médicos típicos:
- Médico escala un episodio a colegas o al supermédico cuando duda.

Casos de uso no médicos:
- Escalar una factura sospechosa a un par contable.
- Escalar un contrato dudoso a legal.

#### 7.3.6 Geolocalización genérica de entidades

Capacidad nueva en TodoERP. Cualquier entidad puede registrar una ubicación geográfica en su `data.location` y consultarse por proximidad. Detallado en §10.7.

Forma del campo (JSONB en `entities.data.location`):
```json
{
  "lat": -0.180653,
  "lon": -78.467834,
  "accuracy_m": 15,
  "altitude_m": 2850,
  "captured_at": "2026-05-06T15:30:00Z",
  "source": "exif" | "device" | "manual" | "clinic_default"
}
```

Soporte a nivel de BD: extensión `postgis`, columna generada `entities.location_geog GEOGRAPHY(Point,4326)` derivada de `data.location`, índice GIST. Permite `ST_DWithin`, `ST_Distance`, etc. desde una *tool* MCP genérica `entities.search_nearby({ point, radius_m, filter })`.

Casos de uso médicos típicos:
- Distribución epidemiológica de patologías sobre mapa.
- Contexto regional para modelos ISIC (incidencia por latitud/UV).
- Agendamiento por cercanía clínica/paciente.
- Trazabilidad geográfica de imágenes clínicas (lugar de captura).

Casos de uso no médicos:
- Sucursales, rutas de entrega, leads por zona, oficinas asignadas.

Privacidad (ver §13.3): la `lat/lon` cruda es PHI cuando la entidad es clínica. Se almacena bruta para el médico tratante; al exponerla a roles que **no** pueden ver al paciente (modo "caso académico", §10.5), el backend redondea a 0.01° (~1 km) o aplica jitter determinista.

### 7.4 Lo que **no** se añade a TodoERP (vive en el agente o en datos)

- Vocabulario médico (paciente, anamnesis, signos vitales, CIE-10): vive en seed como `entity_definitions` y en el agente como prompts y heurísticas.
- Modelos de IA específicos (ISIC, vademécum, dermNet): el agente los consume; TodoERP solo guarda el resultado vía las *tools* genéricas de classification y vectors.
- Reglas de negocio clínicas (qué slot es crítico, cuándo escalar al supermédico): viven en el agente.

> Regla práctica: si añades algo a TodoERP, debe poder usarse mañana para gestionar inventario o nóminas sin cambios de código.

---

## 8. Servidor MCP de TodoERP

### 8.1 Ubicación y stack

- Carpeta: `TodoERP/mcp/`
- Stack: TypeScript, paquete `@modelcontextprotocol/sdk` (servidor stdio + opcional HTTP/SSE para uso remoto).
- Reutiliza el **pool de Postgres** y los servicios de `TodoERP/backend/src/services/` (mover a `shared/` si es necesario).
- Autenticación: el servidor MCP requiere un **token de servicio** (API key con rol asignado) o un JWT de usuario por *call*; sin auth, ninguna *tool* responde con datos.

### 8.2 Catálogo de tools — todas genéricas

Naming: `<recurso>.<acción>`. **Ningún nombre de tool contiene términos del dominio médico**. El agente compone intenciones clínicas a partir de estas operaciones genéricas, pasando el `definition_slug` apropiado (`patient`, `episode`, etc.) en cada llamada.

#### Identidad y contexto
- `auth.whoami` → usuario actual y permisos efectivos
- `auth.set_active_context(key, value)` → fija contexto arbitrario en la sesión (e.g., `key="patient", value=<id>`); el agente decide qué claves usa

#### Definiciones de entidad
- `definitions.list({ active? })` → lista de tipos disponibles
- `definitions.describe(slug)` → schema de campos actual; el agente lo lee al inicio para saber qué slots tiene cada tipo
- `definitions.required_fields(slug)` → campos obligatorios

#### Entidades (CRUD genérico)
- `entities.create(slug, data, parent_id?)`
- `entities.get(id, { include_relations?, include_attachments? })`
- `entities.update(id, partial_data)` → merge JSONB no destructivo
- `entities.delete(id)` (soft delete)
- `entities.search({ slug?, filters?, query?, limit, offset })` → búsqueda general; el `query` puede dispararse por full-text o vector si el slug tiene embeddings configurados
- `entities.list_children(parent_id, slug?)` → siguiendo `parent_id`
- `entities.list_by_relation(source_id, field_key)` → siguiendo `entity_relationships`

#### Relaciones
- `relations.add(source_id, target_id, field_key)`
- `relations.remove(source_id, target_id, field_key)`
- `relations.list(entity_id, { field_key?, direction? })`

#### Adjuntos
- `attachments.upload(entity_id, field_key, file_metadata)` → metadata; el binario sube por REST aparte (el frontend ya lo hace contra `/api/attachments`)
- `attachments.list({ entity_id?, field_key? })`
- `attachments.delete(id)`

#### Chatter (auditoría y notas)
- `chatter.add_note(entity_id, body, parent_id?)`
- `chatter.list(entity_id)`
- `chatter.log_action(entity_id, { actor, action, payload })` → la usa el bot para registrar cada acción suya

#### Recordatorios (capacidad genérica nueva, ver §9)
- `reminders.create({ entity_id?, due_at, message, channel?, recurrence?, condition? })`
- `reminders.list({ entity_id?, status?, due_before?, owner? })`
- `reminders.complete(id, { result? })`
- `reminders.cancel(id)`
- `reminders.snooze(id, until)`

#### Vectores y clasificaciones (capacidad genérica nueva, ver §10)
- `models.list({ kind? })` → modelos registrados (text-embedder, image-embedder, image-classifier)
- `vectors.upsert(entity_id, field_key, embedding, model_id, metadata?)`
- `vectors.search({ embedding | text | entity_id, model_id, k, filter? })` → k-NN con filtros sobre metadata
- `classifications.set(entity_id, model_id, { labels[], confidence, raw? })`
- `classifications.get(entity_id, { model_id? })`

#### Permisos temporales (capacidad genérica nueva, ver §13.5)
- `permissions.request_temporary({ permission, scope_entity_id?, reason, duration_seconds })`
- `permissions.approve_temporary(id)`
- `permissions.deny_temporary(id, comment?)`
- `permissions.revoke_temporary(id)`
- `permissions.list_active_temporary({ user_id? })`

#### Revisión / escalamiento (capacidad genérica nueva, ver §13.6)
- `entities.request_review(entity_id, { reviewers[], reason, due_at? })` — crea recordatorios para los reviewers y cambia estado de la entidad

### 8.3 JSON Schema por tool

Cada *tool* declara `inputSchema` y `outputSchema` (requisito del MCP SDK). Esto guía al LLM y evita argumentos malformados. Para tools genéricas como `entities.update`, el `inputSchema` no enumera campos por *slug*: simplemente declara que `partial_data` es objeto libre. El **schema específico** del dominio médico vive en `definitions.describe(slug)`, que el agente carga al iniciar conversación y usa para guiar el slot-filling.

### 8.4 ¿Qué hacer si falta una tool?

Si la conversación requiere algo no cubierto, se implementa la tool en el MCP **antes** de avanzar el agente — y se diseña genéricamente. Antes de añadir una tool, hacer la prueba: *¿podría usarse esta misma tool para gestionar facturas o tickets de soporte?* Si no, está mal modelada.

Bypass directo al backend o a la DB desde el agente: prohibido. Toda mutación pasa por el MCP para garantizar auditoría y autorización centralizadas.

### 8.5 Cómo el agente compone intenciones médicas

Ejemplos de "intención clínica → llamada genérica":

| Intención del agente médico | Tool MCP genérica que invoca |
|---|---|
| "Crear paciente" | `entities.create("patient", {...})` |
| "Buscar paciente por cédula" | `entities.search({ slug: "patient", filters: { cedula: "..." } })` |
| "Iniciar episodio" | `entities.create("episode", { ... }, parent_id: <patient_id>)` + `relations.add(...)` |
| "Anotar anamnesis" | `entities.update(<episode_id>, { anamnesis: "..." })` |
| "Marcar diagnóstico" | `entities.create("diagnosis", { episode_id, codigo, ... })` |
| "Recordar control en 14 días" | `reminders.create({ entity_id: <episode_id>, due_at: +14d, message: "..." })` |
| "Buscar imágenes parecidas" | `vectors.search({ entity_id: <image_id>, model_id: "isic-resnet50", k: 10 })` |
| "Guardar predicción ISIC" | `classifications.set(<image_id>, "isic-resnet50", { labels, confidence })` |

---

## 9. Sistema de alertas y recordatorios (capacidad nueva, genérica)

### 9.1 Por qué

El bot debe permitir al médico dar **seguimiento** real al paciente: recordar revisiones, repreguntar evolución, avisar de hallazgos pendientes. Hoy TodoERP no tiene esta capacidad; se diseña ahora como módulo genérico del ERP, reutilizable para vencimientos contables, cumpleaños de cliente, renovación de contratos, etc.

### 9.2 Modelo de datos

**Tabla nueva `reminders`** (genérica, no en `entities`):

```sql
CREATE TABLE reminders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id       UUID REFERENCES entities(id) ON DELETE CASCADE,  -- opcional: anclado o no
    owner_user_id   UUID REFERENCES users(id) ON DELETE CASCADE,     -- a quién se le recuerda
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    title           VARCHAR(500) NOT NULL,
    message         TEXT,
    due_at          TIMESTAMPTZ NOT NULL,
    recurrence      JSONB,           -- { rule: 'rrule:...', until: ... }
    condition       JSONB,           -- opcional: condición que debe cumplirse para disparar
    channels        JSONB DEFAULT '["in_app"]',  -- array: in_app | email | webhook | push
    status          VARCHAR(50) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','snoozed','sent','done','cancelled','failed')),
    result          TEXT,            -- al completar, qué pasó
    last_attempt_at TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reminders_due_pending ON reminders(due_at) WHERE status='pending';
CREATE INDEX idx_reminders_owner ON reminders(owner_user_id, status);
CREATE INDEX idx_reminders_entity ON reminders(entity_id);
```

`entity_id` es opcional: un recordatorio puede estar anclado a una entidad (un episodio, una factura) o ser libre ("llamar a María a las 17h").

### 9.3 Componentes

| Componente | Responsabilidad |
|---|---|
| **Tabla `reminders`** | Almacenamiento. |
| **Scheduler** (proceso interno backend) | Cada N segundos consulta `due_at <= NOW() AND status='pending'`; entrega a los canales; marca `sent`. |
| **Drivers de canal** | `in_app` (escribe a `chatter` o cola por usuario), `email` (SMTP), `webhook` (POST a URL configurada), `push` (Web Push si frontend lo habilita). |
| **API REST** (en TodoERP) | CRUD `/api/reminders`. |
| **Tools MCP** | `reminders.create`, `list`, `complete`, `cancel`, `snooze` (ya en §8.2). |
| **UI** | Panel "Mis recordatorios" en el sidebar; marca de pendientes en cada entidad relacionada. |

### 9.4 Recurrencia y condiciones

- **Recurrencia**: subset de RRULE (RFC 5545). Suficiente con: diario, semanal, mensual, "cada N días/semanas". Implementación: librería liviana (`rrule` en npm) o regla propia minimal.
- **Condición**: JSONB con expresión simple evaluable contra los datos de la entidad (e.g., `{ field: "estado", op: "eq", value: "pendiente" }`). Si la condición no se cumple cuando llega el `due_at`, el recordatorio se reagenda.

### 9.5 Permisos (genéricos)

- `reminders:create`, `reminders:read_own`, `reminders:read_all`, `reminders:complete`, `reminders:cancel`.
- El agente médico, al actuar en nombre del médico, hereda los permisos de éste.

### 9.6 Uso desde el agente médico (ejemplos)

- **Tras cerrar episodio**: bot llama `reminders.create({ entity_id: <episode_id>, owner_user_id: <medico_id>, due_at: now+14d, title: 'Control', message: 'Verificar evolución de X' })`.
- **Si el paciente no responde a control**: una segunda regla con `condition` chequea si hubo nuevo episodio; si no, dispara aviso al médico.
- **Toma de medicación**: si el paciente acepta, recordatorios diarios con canal `push` durante la duración del tratamiento.

> **Decisión abierta D-9:** ¿qué canales habilitamos en v1? Recomendación: `in_app` siempre, `email` opcional. Push y webhook en v2.

---

## 10. Vector store y clasificación de entidades (capacidad nueva, genérica)

### 10.1 Por qué

Las imágenes clínicas (en dermatología, fotos de lesiones) deben:
1. Ser **clasificables** por uno o varios modelos de identificación de patrones (ISIC, melanoma vs. nevus, dermatitis, etc.).
2. Ser **comparables** vía similitud para encontrar casos parecidos en la base.

Esto exige guardar embeddings (vectores) y predicciones (clasificaciones) por imagen, vinculadas al modelo que las generó. Diseño genérico: cualquier entidad —no solo imágenes, también textos, documentos— puede tener vectores y clasificaciones.

### 10.2 Modelo de datos

**Extensión Postgres**: `pgvector`.

**Tabla `models_registry`** (genérica):

```sql
CREATE TABLE models_registry (
    id              VARCHAR(128) PRIMARY KEY,        -- ej: 'isic-resnet50-v1', 'openai-text-embedding-3-small'
    kind            VARCHAR(50) NOT NULL             -- 'text-embedder' | 'image-embedder' | 'image-classifier' | 'text-classifier'
                    CHECK (kind IN ('text-embedder','image-embedder','image-classifier','text-classifier','multimodal')),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    dimensions      INTEGER,                          -- para embedders
    labels          JSONB,                            -- para classifiers: { code: human_label }
    config          JSONB DEFAULT '{}',               -- endpoint, version, etc.
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Tabla `vector_embeddings`** (genérica):

```sql
CREATE TABLE vector_embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id       UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    field_key       VARCHAR(255),                     -- opcional: qué campo de la entidad embeddió
    model_id        VARCHAR(128) NOT NULL REFERENCES models_registry(id) ON DELETE CASCADE,
    embedding       vector NOT NULL,                  -- pgvector, dimensión definida por el modelo
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entity_id, field_key, model_id)
);
-- Index HNSW por modelo para búsquedas rápidas:
-- CREATE INDEX ... ON vector_embeddings USING hnsw (embedding vector_cosine_ops) WHERE model_id = 'X';
-- Nota: pgvector exige el mismo número de dimensiones por índice; en la práctica creamos un índice por modelo.
```

**Tabla `entity_classifications`** (genérica):

```sql
CREATE TABLE entity_classifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id       UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    model_id        VARCHAR(128) NOT NULL REFERENCES models_registry(id) ON DELETE CASCADE,
    labels          JSONB NOT NULL,                   -- [{label, confidence}, ...]
    raw             JSONB,                            -- respuesta cruda del modelo
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entity_id, model_id)
);
```

### 10.3 Integración con modelos ISIC

ISIC (International Skin Imaging Collaboration) ofrece datasets y modelos para clasificación de lesiones de piel (HAM10000, SLICE-3D, etc.). Estrategia:

| Aspecto | Decisión |
|---|---|
| **¿Entrenar nosotros un modelo?** | No en v1. Tomamos modelos pre-entrenados publicados por ISIC u otros (ResNet50/EfficientNet sobre HAM10000) o servicios hospedados. |
| **Hospedaje** | Servicio Python aparte (FastAPI) corriendo el modelo en GPU/CPU; expone POST `/embed` y `/classify`. Si no hay GPU, modelo más liviano (MobileNet) en CPU. |
| **Llamada** | El backend de TodoERP, al recibir un upload con `field_key='clinical_image'`, dispara un job que llama al servicio Python; al volver, el job hace `vectors.upsert` y `classifications.set`. |
| **Modelos múltiples** | Cada imagen puede pasar por varios modelos a la vez. Se registran como `model_id` distintos. |
| **Etiquetas** | Las etiquetas de los modelos ISIC (melanoma, nevus, BCC, AK, etc.) se cargan en `models_registry.labels`. |
| **Privacidad** | Si se usa servicio externo, las imágenes salen sin metadata clínica (solo el binario). Auditoría de cada llamada. |
| **Investigación pendiente** | Confirmar disponibilidad de pesos open-source actualizados (ISIC 2024/2025 challenges). Workshop ISIC 2026 puede aportar modelos nuevos. |

> **Decisión abierta D-10:** ¿modelo de imagen on-prem o servicio externo? Trade-off: privacidad/coste vs. complejidad de despliegue. Recomendación: empezar con modelo open-source liviano on-prem; subir a servicio gestionado si la calidad no alcanza.
>
> **Decisión abierta D-11:** ¿qué tareas de clasificación priorizamos en v1? Recomendación: triage binario "sospecha alta / no" (melanoma / no melanoma) + multiclase top-5 informativo. No reemplaza al médico; ayuda al triage.

### 10.4 Flujo de procesamiento de imagen

> **Principio rector (D-Aux-1, D-Aux-3):** la IA es estrictamente sugerente. **Ninguna escalación es automática.** Tiempo real no es prioridad; certeza sí.

1. Médico/paciente sube imagen → `attachments` (TodoERP) + se crea entidad `clinical_image` ligada al episodio.
2. Job en cola **pg-boss** procesa la imagen (puede tomar minutos sin problema):
   a. Pre-procesa (resize, normalización).
   b. Llama al servicio del modelo (local, GPU si disponible / CPU fallback) → recibe embedding + labels (triage binario + multiclase top-5).
   c. `vectors.upsert(<image_id>, 'image', embedding, 'isic-resnet50-v1')`.
   d. `classifications.set(<image_id>, 'isic-bin-triage-v1', { labels, confidence })` y `classifications.set(<image_id>, 'isic-multiclass-v1', { labels, confidence })`.
3. El bot, al hablar de la imagen, lee `classifications.get` y la presenta al médico claramente etiquetada como **"Sugerencia IA"**, visualmente diferenciada, nunca cerca de la palabra "Diagnóstico" sin esa etiqueta.
4. El médico decide qué hacer con la información: registrar diagnóstico presuntivo propio, escalar a colegas (CU-8), o solicitar examen complementario. **Nada se decide ni escala sin acción explícita del médico.**

### 10.5 Búsqueda de casos similares

Médico pregunta: *"¿Tenemos casos similares a esta lesión?"*. Bot llama `vectors.search({ entity_id: <image_id>, model_id: 'isic-resnet50', k: 10, filter: { ... } })`. Devuelve imágenes similares; el bot las muestra **anonimizadas** (no se revelan pacientes de otros médicos sin permiso).

Permisos: la búsqueda respeta visibilidad. Resultados de pacientes que el médico no puede ver salen sin metadata identificadora (modo "caso académico").

### 10.6 Permisos (genéricos)

- `vectors:search`, `vectors:write`, `classifications:write`, `classifications:read`.
- `models:manage` (admin).

### 10.7 Geolocalización genérica (cross-cutting)

Capacidad transversal: cualquier entidad (imagen, episodio, diagnóstico, sucursal, lead) puede llevar un campo `data.location` con `{ lat, lon, accuracy_m, altitude_m, captured_at, source }`. Forma exacta y motivación en §7.3.6.

**Soporte de BD** (migración `009_geolocation.sql`):
- `CREATE EXTENSION postgis`.
- Columna generada `entities.location_geog GEOGRAPHY(Point,4326)` derivada de `data->'location'->>'lat'/'lon'` cuando ambos existen y son numéricos finitos.
- Índice GIST sobre `location_geog`.

**Tool MCP genérica** `entities.search_nearby({ point: {lat,lon}, radius_m, type?, filter? })`:
- Usa `ST_DWithin(location_geog, ST_MakePoint(lon,lat)::geography, radius_m)`.
- Devuelve entidades con su distancia en metros.
- Respeta los permisos del rol (igual que cualquier `entities.list`).

**Captura por origen:**
- `clinical_image`: lectura EXIF (`exifr`) al subir el binario; fallback a coords del dispositivo del médico/paciente; fallback final a `clinic_default` configurada en el seed.
- `episode`: hereda del primer `clinical_image` con location; si no hay imagen, coords del dispositivo del médico al cerrar.
- `diagnosis`: hereda del episodio padre (no se captura por separado).
- Entidades no clínicas: setean `data.location` explícitamente (`source: 'manual'`).

**Privacidad** (extiende §13.3):
- La `lat/lon` exacta de una entidad clínica es PHI.
- Para roles que pueden ver al paciente: coordenadas brutas.
- Para roles en modo "caso académico" (§10.5): el backend redondea a 0.01° (~1 km) y elide `accuracy_m`.
- `entities.search_nearby` aplica el mismo filtrado en la respuesta.

**Permisos:**
- `geo:search` — invocar `search_nearby` y leer `data.location` cruda.
- Sin `geo:search` y con sólo `entities:read`, la respuesta entrega la versión redondeada.

---

## 11. Modelo de datos clínico

Todas las entidades viven como `entity_definitions` (slug + config) y registros en `entities` (`data` JSONB). UUIDs prefijados para identificación visual:

| `slug` | Prefijo UUID | Descripción |
|---|---|---|
| `patient` | `11000000-…` | Paciente |
| `episode` | `12000000-…` | Episodio / consulta |
| `diagnosis` | `13000000-…` | Diagnóstico (puede haber 1..N por episodio: presuntivo, diferencial, definitivo) |
| `prescription` | `14000000-…` | Prescripción |
| `lab_order` | `15000000-…` | Orden de laboratorio / examen complementario |
| `clinical_image` | `16000000-…` | Foto clínica (registro lógico; el binario va en `attachments`) |
| `bot_session` | `17000000-…` | Sesión de chat (turnos, slots, paciente activo) |
| `consent` | `18000000-…` | Consentimiento informado del paciente (LOPDP, imagen, etc.) |
| `icd10_code` | `19000000-…` | Catálogo CIE-10 (datos, no código) |

> Los prefijos `m1..m9` originalmente propuestos no son hex válido para UUID; el seed de Fase 3 usa `11..19` para conservar el ancla visual sin violar el formato.

### 11.1 Paciente — campos sugeridos (`data` JSONB)

Identidad: `nombre`, `apellidos`, `cedula` (único, con índice), `fecha_nac`, `sexo`, `email`, `telefono`, `direccion`.
Médicos: `tipo_sangre`, `alergias[]`, `medicacion_actual[]`, `antecedentes_personales`, `antecedentes_familiares`, `habitos` (tabaco, alcohol, etc.), `seguro_medico`.
Sistema: `medico_principal_id` (rel), `consentimientos[]` (LOPDP, fotos, etc.), `notas_internas`.

> **Decisión abierta D-2:** ¿qué campos son obligatorios al registrar un paciente? Recomendación: solo `nombre` + `cedula` o `email`. El resto se completa por chatbot a lo largo de visitas.

### 11.2 Episodio — campos sugeridos

`patient_id` (rel), `medico_id` (rel), `fecha`, `tipo` (presencial/virtual), `motivo_consulta`, `anamnesis`, `signos_vitales` (presión, FC, FR, temp, SatO2, peso, talla), `examen_fisico`, `imagenes[]` (rel a `clinical_image`), `diagnostico_principal_id` (rel a `diagnosis`), `diagnosticos_diferenciales[]`, `plan`, `prescripcion_ids[]`, `seguimiento`, `proximo_control_fecha`, `proximo_control_motivo`, `reminder_ids[]` (rel a `reminders`), `estado` (en_curso, cerrado, en_revisión), `location` (genérico §10.7; hereda de la primera imagen con coords, o se setea al cierre con coords del dispositivo del médico).

> Los campos de seguimiento (`proximo_control_*`, `reminder_ids`) son **datos**, no código de TodoERP. El agente los completa al cerrar el episodio y crea los `reminders` correspondientes vía la *tool* genérica.

### 11.3 Diagnóstico

`episode_id`, `tipo` (presuntivo/diferencial/definitivo), `codigo_cie10`, `descripcion`, `confianza` (0..1), `notas`, `revisado_por` (rel a supermédico), `aprobado_at`, `location` (genérico §10.7; hereda del episodio padre).

### 11.4 Imagen clínica (`clinical_image`)

Entidad lógica que envuelve una imagen subida al sistema y centraliza su clasificación:

- `episode_id` (rel), `patient_id` (rel), `attachment_id` (referencia al binario en `attachments`).
- `field_key`: identifica qué tipo de imagen (lesión, dermatoscopia, panorámica, ambiente).
- `body_region`, `lesion_id` (si la lesión se está siguiendo en el tiempo, se mantiene el mismo `lesion_id` entre fotos sucesivas).
- `consentimiento_uso_imagen`: bool.
- `classification_ids[]`: poblado automáticamente cuando el job de §10.4 termina; cada uno apunta a un registro en `entity_classifications`.
- `embedding_status`: `pending | done | failed`.
- `location` (genérico, §10.7): extraído de EXIF al subir; fallback al dispositivo o `clinic_default`.

Búsqueda visual: el bot puede invocar `vectors.search` pasando un `clinical_image.id` y obtener IDs de imágenes similares en la base, respetando permisos.

### 11.5 Bot session

Por cada conversación: `user_id`, `active_patient_id`, `active_episode_id`, `turns[]`, `extracted_slots` (lo que ya se rellenó), `pending_slots` (lo que aún falta), `tool_calls[]`. Sirve para reanudar y para entrenar/auditar.

### 11.6 Asignación médico↔paciente y seguimiento

- Relación primaria: campo `medico_principal_id` en paciente.
- Relación de cobertura: cada episodio enlaza `medico_id`; el médico que ha atendido un episodio gana lectura sobre ese episodio aunque no sea el principal.
- Pacientes "sin médico asignado" caen en una bandeja del supermédico.
- Equipos: opcional vía `entity_relationships` con `field_key='medico_secundario'`.

---

## 12. Diseño del chatbot conversacional

### 12.1 Arquitectura del agente

El bot es un **agente con tool-use**:
1. Recibe el último mensaje del usuario + historial.
2. Carga contexto: rol, paciente activo, episodio en curso, definiciones de entidad relevantes (vía `entity_definitions.describe`).
3. Construye prompt con: rol del usuario, contexto del paciente, esquema de slots pendientes, *tools* MCP disponibles.
4. LLM decide: ¿responder en lenguaje natural? ¿llamar una *tool*? ¿pedir un slot faltante? ¿no hacer nada y devolver pregunta?
5. Ejecuta *tool calls* contra el servidor MCP. Reinyecta resultados al LLM.
6. Devuelve respuesta final por SSE al frontend.

### 12.2 Política de baja fricción (slot filling progresivo)

Reglas del prompt del sistema:

- **Una sola pregunta por turno** (salvo síntesis final).
- **Prioriza** lo que cambia el diagnóstico, no lo que llena el formulario.
- **Confirma antes de persistir** datos sensibles (alergia nueva, medicación, diagnóstico).
- **Nunca repreguntes** lo ya contestado (releer `data` del episodio vía `entities.get(<episode_id>)` antes de preguntar).
- **No bloqueas** la conversación si falta un slot opcional: lo dejas y avanzas.
- **Persiste por incrementos**: cada vez que extraes un dato, llamas `entities.update(<episode_id>, { campo: valor })`. No esperas a tener todo.

### 12.3 Modos por rol

| Rol del usuario | Modo del bot | Comportamiento |
|---|---|---|
| Guest | Informativo público | Orientación dermatológica anónima, agendamiento, sin persistencia. **v1 desde día 1** (refactor del bot actual, D-Aux-6). |
| Paciente | Autollenado guiado | Pregunta antecedentes, alergias, medicación; mensajería con su médico. **Diferible a v1.5/v2 (D-5/D-Aux-8).** |
| Médico | Asistente clínico | Toma dictado del médico, extrae anamnesis/examen/diagnóstico, persiste en episodio activo, busca pacientes, sube imágenes, escala casos a colegas (CU-8). |
| Supermédico | Revisor | Resume episodios, lista pendientes de revisión y de aprobación de break-glass, permite anotar/comentar. |
| Admin | — | El admin **no usa el bot** (D-Aux-4); usa la UI de TodoERP. |

### 12.4 Contexto del paciente

Mecanismo:
- En cada sesión, el bot mantiene `active_patient_id` y `active_episode_id`.
- Para el médico: al iniciar conversación, el frontend manda el paciente seleccionado de la UI; o el bot llama `entities.search({ slug: "patient", query: "..." })` y confirma con el médico.
- Para el paciente: el `active_patient_id` es siempre el propio (no negociable).
- Cualquier *tool call* que reciba `patient_id` distinto al activo y el rol no lo permita → 403 desde el MCP.

### 12.5 Manejo de imágenes

- En modo médico, el chat permite adjuntar fotos (input nativo en frontend).
- El frontend sube el archivo vía REST de TodoERP (`POST /api/attachments`) con `entity_id` = episodio y `field_key` = `imagenes`.
- El bot recibe del frontend la metadata del adjunto y registra una nota tipo `change` en el chatter del episodio: *"Médico subió imagen X"*.
- Las imágenes son **siempre** ligadas a un episodio + paciente; nunca sueltas.

### 12.6 Streaming y latencia

Mantener el streaming SSE actual. Las *tool calls* **no** se streamean al usuario; se muestran como estado intermedio (`status: 'consultando ficha…'`) y la respuesta final sí se streamea.

### 12.7 LLM

- Mantener compatibilidad con varios proveedores (DeepSeek ya configurado, NVIDIA, NaN). El `.env` actual ya soporta `AI_PROVIDER`.
- Requisito: el modelo elegido debe soportar **tool calling** correctamente en el formato OpenAI-compatible. DeepSeek lo soporta. Validar antes de comprometer.

> **Decisión abierta D-3:** modelo final para producción. Trade-off: latencia (DeepSeek bajo, Claude alto) vs. calidad de tool-use (Claude alto). Recomendación: DeepSeek para v1, abstraer detrás de interfaz.

---

## 13. Roles, permisos y seguridad

### 13.1 Matriz de permisos (resumen)

| Recurso/acción | guest | paciente | médico | supermédico | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| `patient:read_own` | — | ✓ | — | ✓ | — |
| `patient:read_assigned` | — | — | ✓ | ✓ | — |
| `patient:read_all` | — | — | — | ✓ | — |
| `patient:create` | — | — | ✓ | ✓ | — |
| `patient:update_own` | — | ✓ (campos limitados) | — | ✓ | — |
| `patient:update_assigned` | — | — | ✓ | ✓ | — |
| `episode:create` | — | — | ✓ | ✓ | — |
| `episode:read_own_patient` | — | ✓ | — | ✓ | — |
| `episode:read_assigned` | — | — | ✓ | ✓ | — |
| `episode:update_assigned` | — | — | ✓ | ✓ | — |
| `episode:override` (sobrescribir trabajo de otro médico) | — | — | — | ✓ | — |
| `episode:request_review` (escalar a colegas) | — | — | ✓ | ✓ | — |
| `diagnosis:write` | — | — | ✓ | ✓ | — |
| `diagnosis:set_definitive` (requiere evidencia AP adjunta, D-Aux-2) | — | — | ✓ | ✓ | — |
| `diagnosis:approve` | — | — | — | ✓ | — |
| `attachment:upload` | — | ✓ (su ficha) | ✓ | ✓ | — |
| `attachment:read_clinical` | — | ✓ (suyas) | ✓ (asignadas) | ✓ (todas) | — |
| `prescription:write` | — | — | ✓ | ✓ | — |
| `chat:bot` (puede usar el bot) | ✓ (modo guest) | ✓ | ✓ | ✓ | — |
| `bot:audit:read` | — | — | — | ✓ | ✓ (logs técnicos) |
| `users:manage` | — | — | — | — | ✓ |
| `roles:manage` | — | — | — | — | ✓ |
| `forms:manage` | — | — | — | — | ✓ |
| `models:manage` (modelos ISIC, embeddings) | — | — | — | — | ✓ |
| `temporary_permissions:request_break_glass` (TTL ≤ 1h) | — | — | — | ✓ | ✓ (sobre clínicos) |
| `temporary_permissions:request` (solicitud aprobada) | — | — | ✓ | ✓ | ✓ |
| `temporary_permissions:approve` | — | — | — | ✓ | — |
| `temporary_permissions:revoke` | — | — | — | ✓ | ✓ (las propias) |

**Notas clave:**
- *Admin sin acceso clínico por defecto* (D-1): no aparece ✓ en ninguna fila `patient:*`, `episode:*`, `diagnosis:*`, `prescription:*`, `attachment:read_clinical`. Para acceso ad-hoc, usa break-glass (§13.5).
- *Admin no usa el chat médico* (D-Aux-4): TodoERP es solo para él; no hay valor en darle `chat:bot`.
- *Asignación médico↔paciente*: campo `medico_principal_id` en paciente + relaciones por episodio (un médico que atendió un episodio gana lectura sobre ese episodio).
- *Diagnóstico definitivo* requiere evidencia anatomopatológica adjunta (D-Aux-2). Sin evidencia, el sistema lo deja como `presuntivo`.

### 13.2 Mecanismo de autorización

- Se reutiliza `hasPermission` de TodoERP (`authMiddleware.ts`).
- El servidor MCP recibe el JWT/API key del usuario, resuelve su rol, y para cada *tool call* aplica el chequeo correspondiente.
- Para `read_assigned` se usa `entity_relationships` (médico → paciente) o el campo `medico_principal_id`.
- **Privilege escalation prevention** del TodoERP también aplica para asignación de roles clínicos.

### 13.3 Seguridad y privacidad

- **Cifrado en tránsito**: HTTPS obligatorio en producción.
- **Cifrado en reposo**: Postgres con `pgcrypto` ya activo. Datos especialmente sensibles (cédula, diagnósticos) → considerar columnas cifradas en `data` JSONB con clave gestionada fuera de la DB.
- **Cumplimiento LOPDP (Ecuador, 2021)**:
  - Consentimiento informado almacenado por paciente.
  - Derecho de acceso, rectificación, eliminación: el paciente puede pedir export/borrado.
  - Registro de tratamiento (qué se almacena, finalidad, base legal).
- **Auditoría**: cada *tool call* del bot deja entrada en `chatter` con `created_by = bot:<user_id>`. Cada uso de break-glass deja entrada en chatter de la entidad accedida.

#### 13.3.1 Regla obligatoria de PII inbound vs outbound (D-4)

- **Inbound** (usuario → bot → DB): el usuario puede mandar PII libremente (e.g., "mi cédula es 1234567890"). El LLM la ve **una vez** en el turno en que se teclea (necesario para extraer y persistir). Se almacena en el `data` JSONB del paciente.
- **Outbound** (DB → contexto → LLM): cuando el agente carga datos del MCP para inyectar en el prompt, debe **redactar** los campos marcados `pii: true` en `definitions.describe`. Reemplazo por placeholder (e.g., `<PACIENTE>`, `<CEDULA_REDACTADA>`, `<TELEFONO_REDACTADO>`).
- Implementación: paso obligatorio en `cepi-bot/src/agent.ts`, no skippeable, con tests que prueben que ningún campo `pii: true` aparece en el prompt enviado al LLM cuando viene de lectura.
- Campos típicos `pii: true`: `nombre`, `apellidos`, `cedula`, `email`, `telefono`, `direccion`, `fecha_nac`. Diagnóstico, anamnesis, examen físico **no** son PII en este sentido (son contenido clínico necesario para el razonamiento).

- **Retención**: episodios cerrados conservados 10 años (norma médica común); sesiones de bot crudas, 90 días con resumen permanente.

### 13.4 Rate limiting y abuso

- En el endpoint de chat, por usuario: N mensajes/min (configurable).
- Para guest: límites más estrictos (ya hay precedente en server.js actual).

### 13.5 Permisos temporales (break-glass) — capacidad genérica

Mecanismo para otorgar acceso puntual y auditado a recursos que normalmente están fuera del alcance del usuario. **Genérico**: aplica a cualquier permiso del sistema, no solo a entidades clínicas.

**Schema** (nueva tabla en TodoERP):

```sql
CREATE TABLE temporary_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    granted_to      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by      UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL si fue self-serve break-glass
    permission      VARCHAR(255) NOT NULL,                          -- ej. 'patient:read_all', 'patient:read'
    scope_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE, -- opcional: restringe a UNA entidad
    reason          TEXT NOT NULL,                                  -- justificación obligatoria
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','expired','revoked','denied')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_temp_perm_granted_to_active ON temporary_permissions(granted_to)
    WHERE status='active' AND expires_at > NOW();
```

**Dos modos:**

1. **Self-serve break-glass** (TTL ≤ 1h, scope acotado a 1 entidad):
   - Usuario solicita justificando.
   - Si está dentro de los límites permitidos por su rol, se concede automáticamente (`status='active'`).
   - Recordatorio inmediato al supermédico (`reminders.create`, canal `in_app` + `email`): "X accedió a Y, motivo Z".
   - Cada lectura usando este permiso escribe entrada en `chatter` de la entidad accedida con `actor=X via break-glass`.

2. **Solicitud aprobada** (TTL >1h o scope amplio):
   - Queda en `status='pending'` hasta que el supermédico apruebe o rechace.
   - Aprobación: `status='active'`, recordatorio al solicitante.
   - Rechazo: `status='denied'`, comentario opcional del supermédico.

**Integración:**
- `verifyToken` (TodoERP `authMiddleware.ts`) carga permisos efectivos = permisos del rol ∪ permisos temporales activos del usuario.
- Caché TTL 30s actual se invalida al otorgar/revocar.
- Job pg-boss cada 60s marca `status='expired'` los vencidos.
- UI: vista "Accesos temporales" en TodoERP — quién pidió qué, cuándo, justificación, qué leyó después (ligado al chatter). Por defecto en el dashboard del supermédico.

**Tools MCP genéricas** (también en §8.2):
- `permissions.request_temporary({ permission, scope_entity_id?, reason, duration_seconds })` → modo (1) o (2) según límites del rol del solicitante.
- `permissions.approve_temporary(id)` (supermédico).
- `permissions.deny_temporary(id, comment?)` (supermédico).
- `permissions.revoke_temporary(id)` (supermédico, granter, o el propio granted_to).
- `permissions.list_active_temporary({ user_id? })`.

**Permisos sobre el sistema temporal:** ver matriz §13.1.

### 13.6 Escalación entre médicos — capacidad genérica

Acción explícita del médico para que un caso lo revisen colegas. **Nunca automática**: la decisión de escalar es del médico humano (D-Aux-1, D-Aux-3).

- Tool y endpoint: `entities.request_review(entity_id, { reviewers: [user_id, ...], reason, due_at? })`.
- Efectos:
  - Crea `reminders` para cada reviewer (canal `in_app` + `email`), referenciando la entidad.
  - Cambia el campo `estado` (configurable por slug; default `en_revisión_solicitada`).
  - Anota en `chatter` de la entidad: "Escalado por X a [Y, Z]. Motivo: …".
  - Cuando un reviewer comenta o agrega entidad-hija (e.g., un `diagnosis` diferencial), notifica al solicitante.
- **Genérico**: el ID de la tool no menciona dominio médico; sirve para escalar facturas dudosas, tickets, contratos, etc.
- En el contexto médico: el médico escala un episodio a un colega o al supermédico cuando duda del diagnóstico (con o sin sugerencia de la IA).

### 13.7 Registros por organización y org sandbox (D-Aux-21) — capacidad genérica

Las organizaciones (migración 016, plan en `docs/ORGANIZACIONES_PLAN.md`) separaban la ficha y el chat, pero dejaban al **paciente global**. Con más de una org real (telemedicina y el consultorio que espeja DrPro) y con una org de pruebas en producción (la cuenta demo de Apple, §24.7), eso filtraba pacientes reales a quien no debía verlos.

**Decisión:** todo lo clínico es de **una** organización. Una persona atendida en dos orgs tiene **un registro de paciente por org**; cada uno ve solo lo suyo.

- **Org-scoped** (`ORG_SCOPED_DEFS`): paciente, episodio, sesión del bot, diagnóstico, receta, laboratorio, imagen, consentimiento e **informe de patología** (migración 021 para paciente y patología). `org_id NOT NULL`, estampado con la org activa del token al crear (nunca del payload; sin org activa, la org por defecto). Con org activa, leer, buscar, filtrar, editar, borrar y restaurar solo dentro de esa org; lo de otra org responde **404**.
- **Sin org activa** (API keys, tokens sin `org_id`, guest): paciente e informe de patología (`ORG_REQUIRED_DEFS`) **no se ven ni se referencian**. El resto de las scoped conserva la regla de 016 (todo menos lo de una sandbox) porque el bot guest lee y escribe sus sesiones con una API key sin org.
- **Referenciar es leer.** Un campo de relación solo puede apuntar a una fila scoped de la misma org (400). Los inversos (`_relations`, p. ej. los episodios del paciente) se filtran a lo visible: con datos anteriores, un paciente podía tener episodios de otra org.
- **Adjuntos**: `attachments.org_id NOT NULL` (021), estampado al subir. Hace falta porque se suben **sin entidad** (la imagen clínica los referencia después). Chatter no necesita columna: basta el chequeo por entidad.
- **Integraciones y colas sin org**: `/api/drpro`, `/api/doctopro` y `/api/patologia/bandeja` solo abren si la org activa tiene la feature en `organizations.data.features` (`requireOrgFeature`). Cierra también a cuentas `pendiente` sin membresía.
- **Patología** (§23): el importador busca la cédula por SQL en todas las orgs **no sandbox** y crea **un informe por org** con ficha de ese nombre, con un token de esa org. Idempotente por `(org_id, numero_cp)`. Lo que no se asocia va a la bandeja, que no es de ninguna org (feature `patologia`, hoy en `cepi-drpro`). Si en una org la cédula tiene varias fichas o el nombre no coincide, se importa donde sí y el caso queda en la bandeja sin datos de la ficha.
- **Org sandbox** (`data.sandbox = true`): los datos ya los aísla la org; la marca agrega la regla de **personas**. Desde ella solo se alcanza a sus miembros (`/groups/:slug/members` y conteos, grupo `all`, `request_review`, `POST /reminders`, `assign`), y `assignDefaultOrgs` nunca agrega a una sandbox. La org activa por defecto de quien está en una real y una sandbox es la real (`getUserOrgs` las ordena al final); entre reales, la más antigua, no la primera por nombre. El superadmin ve en el selector todas las orgs activas, con las suyas primero (`getSelectableOrgs`), y puede quedarse en una de la que no es miembro.
- **Membresía de la sandbox: manual.** Seed 017 saca de `cepi-testing`, **una sola vez** (marca `data.membresias_depuradas_at`), a todo el que además es miembro de una org no sandbox: los médicos reales que entraron por el default de registro. Desde entonces solo un admin agrega o quita miembros, y re-aplicar 017 no vuelve a depurar. 007 no se tocó (cambiarlo haría que el deploy re-aplique 007–013 sobre producción) y sigue sumando a los usuarios demo a la sandbox: 017 los saca en cada aplicación, por su lista de emails. En desarrollo, `seeder/006` crea dos colegas ficticios solo de la sandbox, en `dermatologia`.
- **Admin de organización.** `user_organizations.role_in_org = 'admin'` administra a la gente de esa org sin ser superadmin: `/api/admin/*` acota el listado a los usuarios de sus orgs, solo ofrece roles que el llamador podría otorgar (`assertCanGrant`, la misma regla que `/api/security`), nunca toca una cuenta cuyo rol concede el comodín —aunque sea miembro de su org— y al repartir membresías solo agrega o quita las orgs que administra. El superadmin (`*:*:*:*`) sigue viendo todo. En la UI el botón Admin aparece con cualquiera de los dos; los controles que el admin de org no puede usar se ven deshabilitados con el motivo, no escondidos. Antes el rol existía en la base y en `/api/orgs/:id/members`, pero no abría ninguna pantalla: administrar usuarios exigía el comodín, que además ve todas las organizaciones.
- **Orgs de cepi**: `cepi` "CEPI Telemedicina", `cepi-drpro` "CEPI Consultorio" con features `drpro`, `doctopro`, `patologia` (seed 018), `cepi-testing` "CEPI Testing", sandbox con 6 pacientes ficticios (seed 017). Los nombres los fija el seed 019 y no nombran el sistema de origen; los slugs y las features sí, porque no se muestran como nombre. `doctopro` es la cuenta sandbox vieja de la misma plataforma (read/write, "degradada a tipo directorio"); `drpro` es el espejo de producción.
- Punto único: `TodoERP/backend/src/services/orgScope.ts`. Las lecturas por SQL directo (`review-queue`, `patient-assignments`, `patient-thread`, importador de patología) usan los mismos predicados. El bot y el MCP llegan a los datos solo por la API con el token del usuario.

**Seeds re-aplicables.** El deploy corre todo el SQL pendiente en una transacción y re-aplica cada seed posterior a uno que cambió, así que 017 y 018 no llevan `BEGIN/COMMIT` propios y son idempotentes en su intención: lo que es de una sola vez lleva marca en `organizations.data` (`cepi-testing.membresias_depuradas_at`; `cepi-drpro.membresias_copiadas_at` y `reparto_inicial_at`), y lo repetible solo actúa sobre datos que siguen mal ubicados. `cepi-drpro` no se modifica si ya existe (nombre y features quedan como los deje un admin).

**Reparto de los datos existentes** (`medical-seed/018_org_drpro.sql`): episodios con `drpro_cita_id` y sus hijas (incluidas sesiones del bot e informes que cuelgan de ellos) → `cepi-drpro`. Pacientes solo DrPro (con `drpro_id` o episodios DrPro, sin nada de telemedicina) → enteros a `cepi-drpro`. Pacientes **mixtos** → el original queda en `cepi` con lo de telemedicina; una copia (id determinista, mismas columnas, con el `drpro_id`) va a `cepi-drpro` y a ella se re-apuntan los episodios DrPro, sus hijas, las relaciones en los dos sentidos, el chatter del espejo y sus adjuntos; cada informe de patología del paciente se duplica en la otra ficha. Los episodios del importador de patología cuentan como neutros. Adjuntos: del espejo → `cepi-drpro`; ligados a una entidad o a una imagen → la org de esa entidad; el resto → `cepi`. Pacientes y adjuntos creados por cuentas solo-sandbox → su sandbox (una vez). **Filas de una sandbox que apuntan a un paciente de otra org** (episodios con sus hijas, sesiones del bot, imágenes, consentimientos) → a la org de ese paciente: es información suya y la cuenta demo no debe verla (repetible: después de moverlas ya no cumplen la condición). Membresías (una vez): todo miembro de `cepi` también lo es de `cepi-drpro`; la cuenta del espejo, solo de `cepi-drpro` (el espejo escribe en la org con la feature `drpro`, sin mirar sus membresías).

**Consulta previa** (solo lectura; correr en producción **antes** de aplicar 021/018):

```sql
-- 1. Organizaciones, marcas y miembros
SELECT o.slug, o.active, o.data, count(uo.user_id) AS miembros
  FROM organizations o LEFT JOIN user_organizations uo ON uo.org_id = o.id
 GROUP BY o.id ORDER BY o.slug;
-- 2. Cuentas de servicio y quién escribió como espejo DrPro (debe ser la cuenta del rol espejo_drpro)
SELECT r.name AS rol, u.id, u.email FROM users u JOIN roles r ON r.id = u.role_id
 WHERE r.name IN ('espejo_drpro', 'espejo_patologia');
SELECT u.email, r.name AS rol, count(*) AS asientos
  FROM chatter c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN roles r ON r.id = u.role_id
 WHERE c.source = 'drpro' GROUP BY 1, 2;
-- 3. Episodios DrPro por org (hoy) y cuántas hijas los acompañan
SELECT o.slug, count(*) AS episodios_drpro
  FROM entity_episode e JOIN organizations o ON o.id = e.org_id
 WHERE COALESCE(e.drpro_cita_id, '') <> '' GROUP BY 1;
SELECT 'diagnosis' AS tabla, count(*) FROM entity_diagnosis x WHERE x.episode_id IN (SELECT id FROM entity_episode WHERE COALESCE(drpro_cita_id,'') <> '')
UNION ALL SELECT 'clinical_image', count(*) FROM entity_clinical_image x WHERE x.episode_id IN (SELECT id FROM entity_episode WHERE COALESCE(drpro_cita_id,'') <> '')
UNION ALL SELECT 'pathology_report', count(*) FROM entity_pathology_report x WHERE x.episode_id IN (SELECT id FROM entity_episode WHERE COALESCE(drpro_cita_id,'') <> '')
UNION ALL SELECT 'bot_session', count(*) FROM entity_bot_session x WHERE x.active_episode_id IN (SELECT id::text FROM entity_episode WHERE COALESCE(drpro_cita_id,'') <> '');
-- 4. Clasificación de pacientes (misma regla que medical-seed/018)
WITH sbx AS (SELECT id FROM organizations WHERE COALESCE(data->>'sandbox','') = 'true'),
     espejo AS (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'espejo_drpro'),
     patologo AS (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'espejo_patologia'),
     ep_drpro AS (SELECT id, patient_id FROM entity_episode WHERE COALESCE(drpro_cita_id,'') <> '' AND org_id NOT IN (SELECT id FROM sbx)),
     cls AS (
       SELECT p.id,
              (COALESCE(p.drpro_id,'') <> '' OR EXISTS (SELECT 1 FROM ep_drpro d WHERE d.patient_id = p.id)) AS drpro,
              (   EXISTS (SELECT 1 FROM entity_episode e WHERE e.patient_id = p.id AND e.id NOT IN (SELECT id FROM ep_drpro)
                            AND e.org_id NOT IN (SELECT id FROM sbx) AND (e.created_by IS NULL OR e.created_by NOT IN (SELECT id FROM patologo)))
               OR EXISTS (SELECT 1 FROM entity_bot_session s WHERE s.active_patient_id = p.id::text
                            AND COALESCE(s.active_episode_id,'') NOT IN (SELECT id::text FROM ep_drpro) AND s.org_id NOT IN (SELECT id FROM sbx))
               OR EXISTS (SELECT 1 FROM entity_clinical_image ci WHERE ci.patient_id = p.id
                            AND ci.episode_id NOT IN (SELECT id FROM ep_drpro) AND ci.org_id NOT IN (SELECT id FROM sbx))
               OR EXISTS (SELECT 1 FROM entity_consent c WHERE c.patient_id = p.id AND c.org_id NOT IN (SELECT id FROM sbx))
               OR EXISTS (SELECT 1 FROM attachments a WHERE a.entity_id = p.id AND (a.created_by IS NULL OR a.created_by NOT IN (SELECT id FROM espejo)))
              ) AS tele
         FROM entity_patient p)
SELECT CASE WHEN drpro AND tele THEN 'mixto (se parte)' WHEN drpro THEN 'solo DrPro (a cepi-drpro)' ELSE 'telemedicina o sin historia (queda en cepi)' END AS clase,
       count(*)
  FROM cls GROUP BY 1 ORDER BY 1;
-- 5. Informes de patología (hoy) y los que cuelgan de episodios del importador
SELECT count(*) AS informes,
       count(*) FILTER (WHERE e.created_by IN (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'espejo_patologia')) AS en_episodio_del_importador,
       count(*) FILTER (WHERE COALESCE(e.drpro_cita_id,'') <> '') AS en_episodio_drpro
  FROM entity_pathology_report pr JOIN entity_episode e ON e.id = pr.episode_id;
-- 6. Adjuntos: del espejo, ligados a una entidad, referenciados por una imagen, resto (→ cepi)
SELECT count(*) AS total,
       count(*) FILTER (WHERE a.created_by IN (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'espejo_drpro')) AS del_espejo,
       count(*) FILTER (WHERE a.entity_id IS NOT NULL) AS ligados,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM entity_clinical_image ci WHERE ci.attachment_id = a.id::text)) AS de_imagen
  FROM attachments a;
-- 7. Filas de una sandbox que apuntan a un paciente de otra org (018 las devuelve a la org del paciente)
WITH sbx AS (SELECT id FROM organizations WHERE COALESCE(data->>'sandbox','') = 'true')
SELECT 'episodios' AS filas, count(*) FROM entity_episode e JOIN entity_patient p ON p.id = e.patient_id
 WHERE e.org_id IN (SELECT id FROM sbx) AND p.org_id <> e.org_id
UNION ALL SELECT 'sesiones del bot', count(*) FROM entity_bot_session s JOIN entity_patient p ON p.id::text = s.active_patient_id
 WHERE s.org_id IN (SELECT id FROM sbx) AND p.org_id <> s.org_id
UNION ALL SELECT 'imágenes', count(*) FROM entity_clinical_image ci JOIN entity_patient p ON p.id = ci.patient_id
 WHERE ci.org_id IN (SELECT id FROM sbx) AND p.org_id <> ci.org_id
UNION ALL SELECT 'consentimientos', count(*) FROM entity_consent c JOIN entity_patient p ON p.id = c.patient_id
 WHERE c.org_id IN (SELECT id FROM sbx) AND p.org_id <> c.org_id
UNION ALL SELECT 'diagnósticos de esos episodios', count(*) FROM entity_diagnosis d JOIN entity_episode e ON e.id = d.episode_id
  JOIN entity_patient p ON p.id = e.patient_id
 WHERE d.org_id IN (SELECT id FROM sbx) AND e.org_id IN (SELECT id FROM sbx) AND p.org_id <> e.org_id;
-- (Antes de 021 el paciente no tiene org_id: correr esta consulta después de 021, dentro
--  del ensayo del deploy, o leer `p.org_id` como 'cepi'.)
-- 8. Pacientes creados por cuentas que solo están en una sandbox (irán a la sandbox)
SELECT count(*) AS pacientes_de_cuentas_solo_sandbox
  FROM entity_patient p
 WHERE p.created_by IN (SELECT uo.user_id FROM user_organizations uo GROUP BY uo.user_id
                         HAVING bool_and(uo.org_id IN (SELECT id FROM organizations WHERE COALESCE(data->>'sandbox','') = 'true')));
-- 9. Misma cédula en más de una ficha hoy (duplicados previos; el importador de patología los manda a la bandeja)
SELECT count(*) AS cedulas_repetidas FROM (
  SELECT regexp_replace(COALESCE(cedula,''), '\D', '', 'g') AS c FROM entity_patient
   WHERE COALESCE(cedula,'') <> '' GROUP BY 1 HAVING count(*) > 1) x;
-- 10. Miembros de cepi-testing que 017 va a sacar (una vez): los que también están en una org no sandbox
SELECT u.email, u.active, r.name AS rol,
       (SELECT string_agg(o2.slug, ',') FROM user_organizations uo2 JOIN organizations o2 ON o2.id = uo2.org_id
         WHERE uo2.user_id = u.id AND o2.slug <> 'cepi-testing') AS otras_orgs
  FROM user_organizations uo JOIN organizations o ON o.id = uo.org_id AND o.slug = 'cepi-testing'
  JOIN users u ON u.id = uo.user_id LEFT JOIN roles r ON r.id = u.role_id
 WHERE EXISTS (SELECT 1 FROM user_organizations uo2 JOIN organizations o2 ON o2.id = uo2.org_id
                WHERE uo2.user_id = u.id AND o2.id <> o.id AND COALESCE(o2.data->>'sandbox','') <> 'true')
 ORDER BY u.email;
```

---

## 14. Casos de uso principales

> Convención de tools en estos casos: el agente solo invoca tools genéricas. Donde aparece `entities.create("episode", ...)` léase "el bot está creando una entidad del tipo episodio"; el MCP no tiene una tool específica de episodios.

### CU-1 — Médico registra una consulta dermatológica

1. Médico abre la app, se autentica, selecciona paciente "Juan Pérez".
2. Frontend manda al bot el `active_patient_id`. Bot llama `entities.get(<patient_id>)` y `entities.search({ slug: 'episode', filters: { patient_id: <id> }, limit: 5 })`.
3. Bot saluda con un brief: *"Juan Pérez, 34a, última consulta hace 2 meses por dermatitis seborreica"*. Pregunta motivo de consulta actual.
4. Médico dicta libremente: *"Vino por una mancha en el antebrazo, hace 3 semanas, le pica de noche, ha usado hidrocortisona sin mejoría."*
5. Bot llama `entities.create("episode", { patient_id, motivo: 'mancha en antebrazo' })` → recibe `episode_id`.
6. Bot extrae slots y llama `entities.update(<episode_id>, { tiempo_evolucion: '3 semanas', sintoma_principal: 'prurito nocturno', tratamientos_previos: ['hidrocortisona sin respuesta'] })`.
7. Bot pregunta lo siguiente más útil: *"¿Algún factor desencadenante claro? ¿Estrés, contacto con alguna sustancia, viajes?"*.
8. Médico sube foto de la lesión → frontend la asocia al episodio (sube binario por REST, llama `entities.create("clinical_image", { episode_id, attachment_id, body_region: 'antebrazo' })`). Job en cola dispara clasificación ISIC (§10.4).
9. Médico sigue dictando exploración. Bot persiste por turnos vía `entities.update`.
10. Al final, médico dice "diagnóstico presuntivo dermatitis de contacto, plan corticoide tópico potente 7 días, control en 2 semanas". Bot:
    - `entities.create("diagnosis", { episode_id, tipo: 'presuntivo', codigo_cie10: 'L25.9', ... })`
    - `entities.update(<episode_id>, { plan: '...', proximo_control_fecha: '+2 semanas' })`
    - `reminders.create({ entity_id: <episode_id>, owner_user_id: <medico_id>, due_at: now+14d, title: 'Control Juan Pérez', message: 'Revisar evolución dermatitis de contacto antebrazo' })`
    - `reminders.create({ entity_id: <patient_id>, owner_user_id: <patient_user_id>, due_at: now+13d, title: 'Recordatorio control', channels: ['email','in_app'] })`
    - Sugiere búsqueda CIE-10 vía `entities.search` sobre el catálogo CIE cargado.
11. Bot resume el episodio en lenguaje natural y pide confirmación. Médico confirma → bot llama `entities.update(<episode_id>, { estado: 'cerrado' })`.

### CU-2 — Paciente autorrellena antecedentes antes de su primera cita

1. Paciente recibe link al portal, se registra, agenda cita.
2. Bot le saluda y le pregunta antecedentes alérgicos, medicación, hábitos. Una pregunta a la vez.
3. Cada respuesta se persiste en su ficha vía `entities.update(<patient_id>, { ... })`.
4. Si el paciente menciona algo crítico (alergia a penicilina), el bot lo marca como `priority: 'high'` y crea `chatter.add_note` con destacado para que el médico lo vea.
5. Bot programa `reminders.create` para 24h antes de la cita ("revisa este resumen").
6. En su consulta, el médico ya tiene la ficha pre-llenada.

### CU-3 — Supermédico revisa diagnósticos del último mes

1. Supermédico entra al dashboard.
2. Le pide al bot: *"Listame los diagnósticos sin revisar de la última semana."*
3. Bot llama `entities.search({ slug: 'diagnosis', filters: { revisado_por: null, created_at: '>= now-7d' } })`.
4. Supermédico abre uno, comenta o aprueba: bot llama `entities.update(<diagnosis_id>, { revisado_por: <super_id>, aprobado_at: now })`.
5. Si el supermédico no atiende su bandeja en 48h, un `reminders` recurrente le avisa.

### CU-4 — Guest hace consulta dermatológica anónima

Como hoy: árbol de decisión en `tree.js`, sin persistencia. Al final, oferta de agendar cita o registrarse como paciente.

### CU-5 — Admin agrega un nuevo campo "antecedente quirúrgico" al paciente

1. Admin va al editor de formularios de TodoERP.
2. Agrega el campo en `form_configs` del entity_definition `patient`.
3. El bot, en su próximo turno, lee `definitions.describe('patient')` y descubre el nuevo slot. Empieza a preguntarlo cuando proceda. **Sin redeploy del bot ni del MCP**.

### CU-6 — Sugerencia IA sobre imagen y casos similares

1. Médico sube foto de una lesión sospechosa durante CU-1.
2. Backend crea `clinical_image` y encola job de clasificación. **El sistema no bloquea**: la consulta sigue. La sugerencia llega cuando esté lista (segundos a minutos).
3. Job llama al servicio Python (modelo ISIC, local). Recibe embedding 1024 dims + clasificaciones binaria y multiclase.
4. Job persiste vía `vectors.upsert` y dos `classifications.set` (triage binario + multiclase).
5. UI del médico marca la imagen con badge "Sugerencia IA disponible". El médico, cuando le interese, abre el detalle.
6. Bot, si está en la conversación cuando la sugerencia llega, lo menciona claramente etiquetado: *"Sugerencia del modelo ISIC (informativa): triage 0.62 sospecha alta; top clases: melanoma 0.62 / nevus atípico 0.24 / BCC 0.08. ¿Quieres ver casos similares?"*.
7. Si médico acepta, bot llama `vectors.search({ entity_id: <image_id>, model_id: 'isic-resnet50-v1', k: 8 })`. Devuelve thumbnails; si el médico no tiene permiso para ver al paciente original, los resultados se anonimizan (modo "caso académico").
8. Médico revisa, **decide si escalar a colegas (CU-8)** o registra su propio diagnóstico (CU-1 paso 10). El sistema **nunca** persiste la predicción del modelo como diagnóstico.

### CU-8 — Escalación a colegas para revisión

1. Médico tiene un caso difícil (sospecha de melanoma o lesión rara, con o sin sugerencia IA).
2. En el episodio, ejecuta acción "Solicitar revisión" → selecciona destinatarios (1+ colegas, supermédico, o "todos los médicos activos") y escribe motivo.
3. Bot llama `entities.request_review(<episode_id>, { reviewers: [<medico1>, <medico2>], reason: "Sospecha melanoma, IA 0.62. Margen mal definido. Pido segunda opinión." })`.
4. Sistema:
   - Crea `reminders` para cada reviewer (canal `in_app` + `email`), cada uno con link al episodio.
   - Cambia `episode.estado` a `en_revisión_solicitada`.
   - Anota en `chatter`: "Escalado por X a [Y, Z]. Motivo: …".
5. Reviewers ven el caso en su bandeja. Cada uno puede:
   - Comentar en el chatter del episodio.
   - Crear un `diagnosis` adicional (e.g., diferencial).
   - Agregar nota.
6. Cuando un reviewer interactúa, el solicitante recibe notificación.
7. El médico solicitante decide qué hacer con las opiniones recibidas. Cierra la revisión cuando le basta.

### CU-7 — Seguimiento longitudinal de un paciente crónico

1. Paciente con dermatitis crónica tiene `medico_principal_id` asignado y un episodio abierto recurrente (`tipo: 'seguimiento'`).
2. Cada 30 días, un `reminders` recurrente con `owner = paciente` le envía mensaje al portal: "¿Cómo está la lesión esta semana?".
3. Paciente responde por chat con descripción + opcional foto. Bot persiste como nota+imagen del episodio (`chatter.add_note`, `entities.create("clinical_image", ...)`).
4. Si el bot detecta empeoramiento o palabras clave ("peor", "sangra", "duele"), crea recordatorio inmediato para el médico (`due_at: now`, canal `in_app`+`email`).
5. Médico revisa el feed cronológico del paciente: imágenes, clasificaciones, mensajes — todo en orden.

### CU-5 — Admin agrega un nuevo campo "antecedente quirúrgico" al paciente

1. Admin va al editor de formularios de TodoERP.
2. Agrega el campo en `form_configs` del entity_definition `patient`.
3. El bot, en su próximo turno, lee `entity_definitions.describe('patient')` y descubre el nuevo slot. Empieza a preguntarlo cuando proceda. **Sin redeploy**.

---

## 15. Plan de implementación por fases

Orden propuesto. Cada fase es desplegable y testeable.

### Fase 0 — Fundación (1-2 días)
- Limpieza del repo raíz (carpetas espurias `D:cepibackend`, etc.).
- Instalar/levantar TodoERP con Postgres local.
- Confirmar que login y CRUD de entidades funcionan.
- Crear rama `feat/medical-assistant`.

> Las fases marcadas con **[TodoERP genérico]** se diseñan e implementan **sin** referencia al dominio médico. Las marcadas con **[médico]** consumen lo genérico.

### Fase 1 — Capacidades genéricas en TodoERP (8-10 días) [TodoERP genérico]
**1A — Sistema de alertas/recordatorios**
- Schema `reminders` (§9.2), drivers `in_app` y `email` (Brevo).
- Scheduler interno (process pull cada N segundos).
- API REST `/api/reminders` y permisos `reminders:*`.
- Cola subyacente: **pg-boss** (cero infra extra).
- Tests: creación, disparo, snooze, cancelación, recurrencia básica.

**1B — Vector store + classifications**
- Habilitar extensión `pgvector` en init script.
- Schemas `models_registry`, `vector_embeddings`, `entity_classifications` (§10.2).
- API REST `/api/vectors` y `/api/classifications` y permisos correspondientes.
- Tests: upsert + búsqueda k-NN, set/get clasificación.

**1C — Permisos temporales (break-glass)**
- Schema `temporary_permissions` (§13.5).
- `verifyToken` integra permisos temporales activos (no expirados, no revocados).
- Tools y endpoints `permissions.request_temporary` / `approve` / `revoke` / `list_active`.
- Job pg-boss expira cada minuto; dispara recordatorio al supermédico cada vez que un break-glass se activa.
- Auditoría: cada lectura usando un permiso temporal escribe en `chatter` de la entidad accedida.

**1D — Acción genérica de revisión**
- Tool y endpoint `entities.request_review(entity_id, { reviewers[], reason, due_at? })`.
- Cambia estado de la entidad (campo configurable por slug; default: `estado: 'en_revisión_solicitada'`).
- Crea `reminders` para cada reviewer.
- Notifica al solicitante cuando un reviewer comenta o agrega entidad-hija (e.g., `diagnosis` diferencial).

### Fase 2 — Servidor MCP de TodoERP (5-7 días) [TodoERP genérico]
- Carpeta `TodoERP/mcp/` con `@modelcontextprotocol/sdk`.
- **Tools genéricas únicamente** (§8.2): `auth.*`, `definitions.*`, `entities.*`, `relations.*`, `attachments.*`, `chatter.*`, `reminders.*`, `vectors.*`, `classifications.*`, `models.*`.
- Auth: API key con rol asignado o JWT pasado por arg.
- Tests: cada tool valida permisos, respeta schema, audita.
- Validación: usar el MCP para gestionar entidades **no médicas** (e.g., facturas) sin un solo cambio de código.

### Fase 3 — Modelo clínico + seeder ficticio (5-7 días) [médico — datos sobre genérico]
- Definir `entity_definitions`: `patient`, `episode`, `diagnosis`, `prescription`, `clinical_image`, `lab_order`, `bot_session`, `consent`, `icd10_code`.
- Seed `medical-seed/004_medical_seed.sql`: roles, permisos, definiciones, modelos en `models_registry`.
- **Seeder ficticio** `medical-seed/seeder/run.js`: ~50 pacientes, ~150 episodios, descarga lazy ~200 imágenes HAM10000 (D-15) con clasificaciones simuladas a partir de la etiqueta ground truth + ruido. ~5-10 bot sessions de ejemplo. Recordatorios distribuidos (vencidos/pendientes/completados).
- Formularios dinámicos básicos en TodoERP admin para que el admin pueda inspeccionar/exportar.
- Roles `guest`, `paciente`, `medico`, `supermedico`, `admin` con permisos construidos sobre recursos genéricos (admin **sin** acceso clínico, ver D-1).
- Tests: CRUD por rol respeta matriz; seeder corre idempotente; admin no puede leer `patient` por defecto y necesita break-glass para hacerlo.

### Fase 4 — Agente médico (7-10 días) [médico]
- Refactor de `backend/server.js` actual a `cepi-bot/`:
  - Cliente MCP del SDK.
  - Loop de tool-use con LLM (proveedor configurable).
  - Gestión de `active_patient_id` y `active_episode_id` por sesión.
  - Modo dispatcher por rol (guest mantiene flujo actual; los demás van al modo agente).
  - Persistencia de `bot_session` vía `entities.create("bot_session", ...)`.
  - Mapa "intención clínica → tool genérica" (§8.5).
- Frontend de chat: envío de `patient_id` activo, render de estados intermedios, subida de archivos.
- Tests E2E con guiones (CU-1 simplificado).

### Fase 5 — Captura clínica completa (1-2 semanas) [médico]
- Slot filling para anamnesis, examen, signos vitales, diagnóstico, plan.
- Catálogo CIE-10 cargado como `entity_definition` "icd10_code" + seed (no tabla específica). Búsqueda vía `entities.search`.
- Subida de imágenes clínicas atadas a episodio (sin clasificación aún).
- Confirmación obligatoria antes de persistir datos sensibles.
- Cierre de episodio crea recordatorio de control (`reminders.create`).

### Fase 6 — Clasificación de imágenes con ISIC (1-2 semanas) [médico — modelos]
- Servicio Python (FastAPI) que aloja modelo ISIC pre-entrenado. Endpoints `/embed`, `/classify`.
- Registrar el modelo en `models_registry` vía seed (`isic-resnet50-v1`).
- Worker que toma jobs de la cola (creada en Fase 1), llama al servicio, persiste vía `vectors.upsert` y `classifications.set`.
- Política de escalación: si confianza ≥ umbral en clase crítica → recordatorio supermédico.
- Bot integra "casos similares" (`vectors.search`) y muestra clasificación al médico como sugerencia.
- Pruebas con dataset HAM10000 / ISIC público.

### Fase 7 — Modo paciente y portal (1 semana) [médico — **diferible a v1.5/v2**]
> Por D-5/D-Aux-8: el modo paciente autenticado es **feature secundaria**. Se construye solo si hay tracción en v1; si no, se difiere. El modo guest (anónimo) sí está en v1.

- Frontend de paciente con su ficha y mensajería con el bot.
- Magic link por email para login (sin contraseñas).
- Bot pregunta antecedentes/alergias.
- Consentimientos LOPDP visibles y firmables (entidad `consent`).
- Agendamiento integrado con el flujo actual de "cita".
- Recordatorios automáticos de cita y de seguimiento (CU-7).

### Fase 8 — Supermédico, dashboards, seguimiento agregado (3-5 días) [médico]
- Vistas agregadas (reportes TodoERP existentes ayudan).
- Workflow de revisión/aprobación de diagnóstico.
- Bandeja de pendientes (recordatorios + escalaciones automáticas).
- Auditoría: dashboard de tool-calls del bot.

### Fase 9 — Endurecimiento y despliegue (1 semana)
- Pseudoanonimización de prompts.
- Rate limiting.
- Logs estructurados.
- Backup y restore de DB (incluye `vector_embeddings` que pueden ser pesados).
- Política de retención implementada (job nocturno usando reminders del propio sistema).
- Documentación operacional.

> Total estimado: ~9-12 semanas de trabajo concentrado para un único desarrollador. Fases 1A/1B y 6 paralelizables si hay segundo dev.

---

## 16. Métricas de éxito

| Métrica | Cómo se mide | Meta v1 |
|---|---|---|
| **Tiempo de carga por consulta** | Comparar minutos tipeando vs. dictando al bot | -40% |
| **Cobertura estructurada** | % de campos clave llenos por episodio | ≥80% |
| **Repreguntas indebidas** | Veces que el bot pregunta algo ya en ficha | <5% |
| **Tiempo de revisión supermédico** | Minutos por episodio revisado | -30% |
| **Errores de persistencia** | Tool calls fallidas / total | <1% |
| **Adopción** | % de consultas registradas vía bot vs. UI clásica | ≥50% en 3 meses |

---

## 17. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| LLM extrae mal un slot crítico (alergia, medicación) | Alto | Confirmación obligatoria antes de persistir; logging de cambios; supermédico revisa |
| Filtración de datos clínicos a LLM externo | Alto | Pseudoanonimización; opción local; acuerdo de procesamiento |
| Bot da diagnóstico definitivo | Alto (legal) | Prompt + tool design lo prohíben; siempre "presuntivo"; disclaimer; firma humana requerida |
| Coste de LLM se dispara | Medio | Streaming corto; resúmenes; caché de definiciones de entidad |
| Adopción baja por médicos | Medio | Pilotear con un grupo, iterar UX; mantener UI clásica como alternativa |
| Cambios de schema rompen el bot | Medio | Bot lee schema dinámicamente vía `entity_definitions.describe`; tests por contrato |
| Latencia inaceptable en tool-use | Medio | Llamadas MCP locales (mismo host); tools lean; paralelización donde aplique |

---

## 18. Decisiones cerradas (cuestionario inicial 2026-05-06)

Todas las decisiones estratégicas v1 han sido resueltas. Las **D-Aux** son nuevas decisiones surgidas durante el cuestionario.

| ID | Decisión | Resolución |
|---|---|---|
| D-1 | Acceso del admin a datos clínicos | **Sin acceso clínico por defecto.** Sistema "break-glass" self-serve (TTL 1h, justificación obligatoria, audit en chatter) + solicitud aprobada del supermédico para casos ampliados. Ver §13.5. |
| D-2 | Campos obligatorios al crear paciente | `nombre` + (`cedula` o `email`). Resto incremental por chat. |
| D-3 | LLM principal | **Claude** (Sonnet 4.6 producción, Haiku 4.5 tareas auxiliares). Abstraído tras interfaz `LLMProvider` para poder cambiar. |
| D-4 | Datos clínicos al LLM externo | **PII inbound permitida** (el LLM ve lo que el usuario teclea), **PII outbound prohibida** (al releer del MCP, el agente redacta nombre/cédula/dirección/teléfono antes de inyectar al prompt). Regla obligatoria en Fase 4. |
| D-5 | Bot conversa con paciente sin médico | Solo en modo paciente autenticado (magic link). Bot ayuda con autollenado y consultas no clínicas; **no emite opinión clínica**. Modo paciente es **feature secundaria**, posiblemente diferida a v1.5/v2. |
| D-6 | Grabaciones de voz si se agrega dictado | No en v1. |
| D-7 | Vademécum / catálogo de medicamentos | Texto libre en v1; dataset estructurado en v2 como `entity_definition` "medication". |
| D-8 | Multi-tenant | **Single-tenant** v1. **Hito v2**: agregar `tenant_id` antes de comercializar a otras clínicas. El modelo polimórfico lo permite sin reescritura. |
| D-9 | Canales de recordatorios v1 | `in_app` (siempre) + `email` (Brevo, free tier 300/día). Push y webhook a v2. |
| D-10 | Modelo de imagen on-prem o gestionado | **Local** con GPU/CPU **configurable** (servicio Python detecta CUDA al boot). Abstracción `ClassifierProvider` permite externalizar después si conviene. |
| D-11 | Tareas de clasificación priorizadas | **Ambas:** triage binario (score 0..1 sospecha) + multiclase top-5 (HAM10000). Las dos puramente informativas para el médico. |
| D-12 | Cola de jobs | **pg-boss** (sobre Postgres, cero infra extra). |
| D-13 | `lesion_id` longitudinal | Sí, opcional. Asignable manualmente desde editor de imagen para series sucesivas de la misma lesión. |
| ~~D-14~~ | ~~Umbral confianza escalación automática~~ | **Descartada.** Nada se escala automáticamente. La escalación entre médicos es **acción explícita**. Ver §13.6. |
| D-15 | Imágenes del seeder | Descarga lazy desde ISIC Archive (HAM10000 subset, ~200 imágenes), caché en `medical-seed/cache/` gitignored. Licencia CC BY-NC-SA → solo dev. |
| **D-Aux-1** | Tiempo real vs certeza | **Certeza es prioridad**, tiempo real no. Cola de clasificación puede tomar minutos. La IA es estrictamente sugerente; nada determinante salvo evidencia anatomopatológica. |
| **D-Aux-2** | Diagnóstico definitivo | Solo cuando hay `evidencia_definitiva_attachment_id` (biopsia, dermatopatología) adjunto. Sin evidencia, queda en `presuntivo` o `diferencial`. |
| **D-Aux-3** | Escalación entre médicos | Acción explícita `entities.request_review(entity_id, { reviewers[], reason, due_at? })` — capacidad **genérica** de TodoERP, sirve para cualquier entidad. Ver §8.2 + CU-8. |
| **D-Aux-4** | TodoERP es exclusivamente para admin | Médicos, supermédicos, pacientes y guests **no usan TodoERP**. Operan en frontend médico unificado (`D:\cepi\frontend`). |
| **D-Aux-5** | Frontend médico | **Una sola app** con modos por rol. Comparte componentes y bundle; UI condicional según permisos del backend. |
| **D-Aux-6** | Bot guest actual (`server.js` + `tree.js`) | **Refactor desde día 1**, sin compatibilidad. No está en producción. |
| **D-Aux-7** | Especialidad | **Híbrido**: optimizado para dermatología hoy; `entity_definitions` y prompts diseñados de modo que extender a otras especialidades sea seed nuevo, no refactor. |
| **D-Aux-8** | Autenticación del paciente | **Magic link por email** (modo paciente es secundario). |
| **D-Aux-9** | Email provider | **Brevo** (free 300/día). Abstracción `EmailChannel` permite migrar. |
| **D-Aux-10** | Idiomas v1 | Español. i18n de TodoERP soporta más; activar inglés cuando lleguen extranjeros. |
| **D-Aux-11** | Backups | `pg_dump` diario (retención 30d) + dump semanal full (retención 1 año). Vectores incluidos. |
| **D-Aux-12** | Logs | `pino` JSON estructurado, rotación diaria, nivel `info` prod / `debug` dev. |
| **D-Aux-13** | Volumen v1 | ~~~100 pacientes en 6 meses~~. **Corregido 2026-09-03** con datos reales de DrPro: **731 pacientes distintos y 810 citas en un solo mes**, 17.990 citas en 2026. El espejo debe ser lazy (D-Aux-17); el seeder ficticio ya no representa la escala real. |
| **D-Aux-14** | Permisos temporales (break-glass) | Capacidad **genérica** nueva en TodoERP. Tabla `temporary_permissions` con TTL, justificación, auditoría. Ver §13.5. |
| **D-Aux-15** | Origen de DrPro | DrPro (doctopro.com) es el sistema **en producción** de la clínica. CEPI es un **espejo aumentado unidireccional**: DrPro → CEPI, nunca al revés. Prepara una migración suave. Ver §21. |
| **D-Aux-16** | Diagnóstico de la ficha | **Un dato único** (`episode.codigo_cie10`) que se pisa con el último valor. Se evaluó y **descartó** una tabla de diagnósticos multi-fuente versionada: el historial de cambios ya lo da `chatter` y los candidatos de la IA con su probabilidad ya van a `entity_classifications`. La procedencia del cambio se marca con `chatter.source` (migración 019). Ver §21.3. |
| **D-Aux-18** | Portal de casos | `casos.cepi.ec`: segunda superficie del frontend médico para **revisar, buscar y consolidar**, no para capturar. Comparte usuarios y componentes con telemedicina; **sin chat** en v1. Reusa los 27 grupos de `FICHA_GROUP_SPEC` en vez del formulario del ERP, que es estructurado por entidad y no tiene forma de ficha. Ver §22. |
| **D-Aux-17** | Materialización lazy | No se baja el histórico completo de DrPro (17.990 citas/año). El espejo indexa la agenda desde el mes en curso y materializa la ficha de un paciente **bajo demanda**. Ver §21.4. |
| **D-Aux-21** | Registros por organización | Todo lo clínico es de **una** org (paciente e informe de patología incluidos): una persona atendida en dos orgs tiene un registro por org, sin deduplicación. Sin org activa no se ve ningún paciente. Integraciones en vivo y bandeja de patología por `organizations.data.features`. Org sandbox (`data.sandbox`): solo alcanza a sus miembros y nadie entra por defecto. Orgs: `cepi` (telemedicina), `cepi-drpro` (consultorio), `cepi-testing` (sandbox). Ver §13.7 y §24.7. |

---

## 19. Glosario

- **MCP** — Model Context Protocol. Estándar para exponer *tools*/recursos a agentes LLM.
- **Slot filling** — técnica de NLU: extraer campos estructurados (slots) de texto libre, turno a turno.
- **Anamnesis** — historia clínica narrada por el paciente al médico.
- **CIE-10 / ICD-10** — clasificación internacional de enfermedades, 10ª revisión.
- **LOPDP** — Ley Orgánica de Protección de Datos Personales del Ecuador (2021).
- **Polimórfico (TodoERP)** — patrón de tablas únicas (`entities`) con discriminador y JSONB para estructura variable.
- **Chatter** — feed de actividad de TodoERP (cambios automáticos + notas humanas).
- **pgvector** — extensión Postgres que añade el tipo `vector` y operadores de distancia (cosine, L2, inner product) para búsqueda de similaridad. Soporta índices IVFFlat y HNSW.
- **HNSW** — Hierarchical Navigable Small World. Índice aproximado de k-NN; alta velocidad de consulta a costa de tiempo de construcción y memoria.
- **ISIC** — International Skin Imaging Collaboration. Iniciativa abierta que publica datasets (HAM10000, SLICE-3D) y modelos para clasificación de lesiones cutáneas.
- **HAM10000** — dataset ISIC con ~10 000 imágenes dermatoscópicas etiquetadas, base habitual para fine-tuning de clasificadores.
- **Embedding** — representación vectorial densa de un dato (texto, imagen) producida por un modelo, usable para búsqueda por similaridad.
- **k-NN** — k-Nearest Neighbors: encontrar los k registros más cercanos a un vector dado.
- **RRULE** — sintaxis de recurrencia del estándar iCalendar (RFC 5545); usada en `reminders.recurrence`.
- **Tool-use / function calling** — capacidad de un LLM de emitir llamadas estructuradas a funciones/tools en lugar de solo texto.
- **Slug (TodoERP)** — identificador corto en minúsculas/snake_case para una `entity_definition` (`patient`, `episode`, etc.).
- **Brevo** — proveedor de email transaccional (antes Sendinblue). Free tier 300 mails/día.
- **pg-boss** — librería Node.js de jobs/cola sobre PostgreSQL; usada como cola interna sin Redis.
- **Magic link** — autenticación sin contraseña: el usuario recibe por email un enlace único de un solo uso que lo autentica al abrir.
- **Break-glass** — concepto operativo: acceso de emergencia a un recurso normalmente vedado, con justificación obligatoria, TTL corto, y auditoría exhaustiva. Ver §13.5.
- **PII** — Personally Identifiable Information. Datos que identifican unívocamente a una persona (nombre, cédula, teléfono, dirección, email).
- **PII inbound vs outbound** — regla operativa del agente: el usuario puede mandar PII al bot (entra una vez al LLM); pero al releer datos del MCP, el agente las redacta antes del prompt. Ver §13.3.1.

---

## 20. Apéndices

### A. Esquema de slot-filling para episodio dermatológico

```yaml
required_for_close:
  - motivo_consulta
  - tiempo_evolucion
  - examen_fisico.descripcion_lesion
  - examen_fisico.localizacion
  - diagnostico_principal
  - plan
recommended:
  - sintomas_asociados
  - tratamientos_previos
  - factor_desencadenante
  - imagenes (≥1)
optional:
  - antecedentes_familiares_relevantes
  - signos_vitales (no siempre relevantes en derma)
ask_order_priority:
  1. motivo_consulta
  2. tiempo_evolucion
  3. localizacion
  4. descripcion_lesion
  5. sintomas_asociados
  6. tratamientos_previos
  7. factor_desencadenante
```

### B. Plantilla de prompt (modo médico) — esqueleto

```
Eres asistente clínico del médico {medico_nombre}.
Paciente activo: {patient_brief} (edad, sexo, alergias, medicación, últimas consultas).
Episodio en curso: {episode_id_or_none}, slots ya rellenos: {filled_slots}.
Slots pendientes prioritarios: {pending_slots_top3}.

REGLAS:
- Una sola pregunta por turno, salvo síntesis final.
- Nunca des un diagnóstico definitivo. Siempre "presuntivo" + diferencial.
- Antes de persistir alergia, medicación, diagnóstico o plan: confirma con el médico.
- Usa tools MCP para todo cambio de datos. No inventes ids.
- Sé conciso, sin emojis, sin lenguaje empático innecesario.

TOOLS DISPONIBLES: {mcp_tools_signatures}
```

### C. Estructura de carpetas final propuesta

```
D:/cepi/
├── docs/
│   └── PAPER.md                   ← este documento
├── TodoERP/                       ← ERP genérico (existente, se extiende)
│   ├── backend/                   ← REST API (Express) + nuevos endpoints genéricos
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── remindersRouter.ts        ← NUEVO (genérico)
│   │       │   ├── vectorsRouter.ts          ← NUEVO (genérico)
│   │       │   ├── classificationsRouter.ts  ← NUEVO (genérico)
│   │       │   └── modelsRouter.ts           ← NUEVO (genérico)
│   │       ├── services/
│   │       │   ├── reminderScheduler.ts      ← NUEVO (genérico)
│   │       │   └── classificationWorker.ts   ← NUEVO (genérico, agnóstico al modelo)
│   ├── frontend/                  ← UI admin (Vue 3)
│   ├── mcp/                       ← NUEVO: servidor MCP (genérico)
│   │   ├── src/
│   │   │   ├── server.ts          ← entry MCP
│   │   │   ├── tools/             ← una tool por archivo: entities/, relations/, reminders/, vectors/, ...
│   │   │   └── auth.ts
│   │   └── package.json
│   └── database/
│       ├── 001_schema.sql                    ← actualizar: pgvector, reminders, vectors, classifications, models_registry
│       ├── 002_seed.sql
│       └── 003_clientes_seed.sql
├── cepi-bot/                      ← agente médico (refactor de backend/ actual)
│   ├── src/
│   │   ├── server.ts              ← /api/chat con SSE
│   │   ├── agent.ts               ← loop de tool-use
│   │   ├── mcpClient.ts
│   │   ├── modes/                 ← guest, paciente, médico, supermédico, admin
│   │   └── prompts/
│   └── package.json
├── medical-models/                ← NUEVO: servicio Python para modelos ISIC
│   ├── app.py                     ← FastAPI: /embed, /classify
│   ├── models/                    ← pesos descargados (gitignored)
│   ├── requirements.txt
│   └── Dockerfile
├── medical-seed/                  ← seed específico médico (datos, no código)
│   └── 004_medical_seed.sql       ← entity_definitions clínicas, roles, permisos, modelos ISIC en models_registry
├── frontend/                      ← UI de chat (existente, evoluciona)
└── ecosystem.config.cjs           ← PM2: backend, mcp, cepi-bot, medical-models, frontend
```

> Observación: `medical-seed/` y `medical-models/` viven fuera de `TodoERP/` para reforzar visualmente que TodoERP no contiene nada médico. Solo configuración (seed) y un servicio externo que el ERP llama.

### D. Ejemplo concreto de tool-call

Conversación:
```
Médico: "Tiene una placa eritematodescamativa en codo, 4 cm, asintomática."
```

LLM decide (tool genérica):
```json
{
  "tool": "entities.update",
  "args": {
    "id": "ep-abc-123",
    "partial_data": {
      "examen_fisico": {
        "descripcion_lesion": "placa eritematodescamativa",
        "tamano_cm": 4,
        "localizacion": "codo"
      },
      "sintomas_asociados": ["asintomática"]
    }
  }
}
```

MCP server (`entities.update`, genérica):
1. `verifyToken` → user role = `medico`.
2. Lee la entidad → discrimina por su `entity_definition.slug` = `episode`.
3. Resuelve permiso requerido como `<slug>:update_assigned` → `episode:update_assigned`.
4. `hasPermission(user, 'episode:update_assigned')` → ok.
5. Verifica que `medico_id` del episodio === `user.sub` (regla genérica de "asignación" basada en metadata del slug, no hardcoded).
6. Hace MERGE no destructivo sobre `data` JSONB.
7. Inserta entrada `change` en chatter con autor `bot:<userid>` y diff de campos.
8. Devuelve la entidad actualizada.

LLM responde al médico:
```
Anotado: placa eritematodescamativa, 4 cm, codo, asintomática.
¿Bordes definidos o difusos?
```

### E. Lista de entity_definitions clínicas para seed (`004_medical_seed.sql`)

| slug | parent permitido | campos clave | índices |
|---|---|---|---|
| `patient` | — | `cedula` (unique), `nombre`, `email`, `medico_principal_id` | unique(cedula), btree(email) |
| `episode` | `patient` | `medico_id`, `fecha`, `motivo`, `estado`, `proximo_control_fecha` | btree(medico_id, fecha desc), btree(estado) |
| `diagnosis` | `episode` | `tipo`, `codigo_cie10`, `confianza` | btree(codigo_cie10) |
| `prescription` | `episode` | `medicamento`, `dosis`, `duracion` | — |
| `clinical_image` | `episode` | `attachment_id`, `body_region`, `lesion_id`, `embedding_status` | btree(lesion_id) |
| `lab_order` | `episode` | `tipo_examen`, `estado_resultado` | — |
| `bot_session` | `patient`? (opcional) | `user_id`, `turns`, `extracted_slots` | btree(user_id, created_at desc) |
| `consent` | `patient` | `tipo`, `texto`, `firma`, `vigencia_hasta` | btree(patient_id, tipo) |
| `icd10_code` | — | `codigo`, `descripcion`, `categoria` | unique(codigo), full-text(descripcion) |

### F. Modelos a registrar en `models_registry` (seed)

| `id` | `kind` | `dimensions` | Origen sugerido |
|---|---|---|---|
| `isic-resnet50-v1` | `image-classifier` | — | Pre-entrenado sobre HAM10000; FastAPI local |
| `isic-img-embed-v1` | `image-embedder` | 1024 | Backbone del clasificador (penúltima capa) |
| `text-embed-multilingual-v1` | `text-embedder` | 768 | Para búsqueda semántica de notas/anamnesis |

### G. Cuestiones para investigación previa antes de Fase 6

- ¿Existen pesos públicos directamente reutilizables del ISIC 2024/2025 challenge?
- Qué dataset usar para validar localmente (HAM10000 funciona; SLICE-3D si hay GPU).
- Métrica objetivo de validación (sensibilidad alta para melanoma, AUC ≥ 0.85).
- Latencia objetivo de clasificación: < 3s por imagen en CPU consumer; < 500ms en GPU.

---

## 21. Espejo DrPro (migración suave)

**DrPro** (doctopro.com, Laravel + JWT) es el sistema **en producción** de la clínica
Centro de la Piel. CEPI no lo reemplaza de golpe: primero lo **espeja y lo aumenta**.
El espejo es **unidireccional — DrPro → CEPI**. CEPI nunca escribe en DrPro (D-Aux-15).

### 21.1 Superficie de origen

La API JWT de DrPro no expone nada clínico (solo catálogos y una lista parcial de
pacientes). Todo lo clínico vive tras la sesión web. Dos endpoints alcanzan:

| endpoint | rol en el espejo |
|---|---|
| `GET /event/api/{doctorId}/{clinicaId}?start&end` | **Índice.** La agenda es el universo: `citaId`, `pacienteId`, fecha, estado. |
| `POST /cita/detallehistorial/{citaId}` | **Ficha completa en una llamada:** `{cita, diagnostico, paciente, edad, recetas, examenes, campos}`. |

Credenciales en el vault (`dotrino-env run --ns drpro`), nunca en `.env`.

Estados de cita: `Terminada` = consulta realizada, tiene ficha. `Pagada` = pagada por
adelantado, cita **futura sin ficha**. `Agendada`/`Confirmada` = futuras.

### 21.2 Qué se usa de verdad

Medido sobre 60 consultas cerradas (sept-2026). El origen tiene ~50 campos clínicos;
se usan **cuatro**:

| campo DrPro | uso | destino en CEPI |
|---|---|---|
| `anamnesis` | 38/40 | `episode.anamnesis` |
| `exploracion` | 37/40 | `episode.examen_fisico` |
| `diagnostico` | 37/40 | `diagnosticos_drpro[]` (trae CIE-10 embebido `(C44.1)Descripción`) |
| `tratamiento` | 37/40 | `episode.plan` |
| campo pers. "Motivo de Consulta" | 49/60 | `episode.motivo_consulta` |
| campo pers. "NOMBRE DEL PROFESIONAL" | 58/60 | `episode.examinador_nombre` |
| `observaciones` | 7/40 | `episode.observaciones` |
| `evolucion` | 4/40 | `episode.seguimiento` |

**Vacío en el 100% de la muestra** — no se migra nada de esto: recetas, exámenes,
imágenes, `diagnosticoPre`/`diagnosticoSec`, los cinco campos de histopatología, y unos
45 campos antropométricos y de signos vitales (peso, altura, presión, IMC, pulso,
perímetros, pliegues, grasa visceral) que están todos en `0.000`.

El **paciente** sí viene bien cargado y se migra entero: identidad, `enfermedades`,
`enfCronicas`, `alergias`, `medicamentos`, `intervenciones`, hábitos (`fumaId`/`tomaId`)
y el consentimiento LOPDP (`consentimiento_datos_*` → entidad `consent`).

### 21.3 El diagnóstico de la ficha (D-Aux-16)

El diagnóstico de un episodio es **un dato único** — `codigo_cie10` + `diagnostico` en
`entity_episode` — que **se pisa con el último valor**. No hay lista de diagnósticos por
fuente, y es deliberado: se evaluó una tabla multi-fuente versionada (`origen`,
`fuente_id`, hash de contenido, triggers) y se descartó por redundante. Lo que parecía
justificarla ya está resuelto en dos sitios que existen:

| lo que hace falta | dónde vive ya |
|---|---|
| quién cambió el diagnóstico y cuándo | `chatter` — `type='change'`, `changes={from,to,label}`, `created_by`, `created_at` |
| los candidatos de la IA con su probabilidad | `entity_classifications` — `model_id` + `labels` (PAPER §D-11, multiclase top-5) |

Una tercera tabla habría sido un tercer lugar donde buscar lo mismo.

Visto desde la ficha el diagnóstico se pisa; el historial completo se consulta en el
chatter del episodio. `diagnostico_fuente` guarda de dónde salió el valor vigente
(`drpro`, el modelo, el médico) para no tener que leer el log solo para eso.

**Límite conocido:** `chatter` solo registra lo que pasa por `PUT /api/entities/:id`.
Una escritura directa por SQL no deja asiento. Por eso el espejo escribe por la ruta —
si escribiera a la tabla, el historial quedaría mudo justo para los cambios importados.

La procedencia se declara con la cabecera `X-Change-Source` y se guarda en
`chatter.source` (migración 019, genérica: la columna es esquema, el valor es dato).
El espejo escribe `drpro`; sin cabecera el asiento queda en NULL = "lo hizo un usuario".

### 21.4 Materialización lazy (D-Aux-17)

Bajar el histórico completo es inviable e innecesario (17.990 citas en 2026). El espejo:

1. **Indexa** la agenda desde el **primer día del mes en curso** (`DRPRO_DESDE`,
   por defecto `date_trunc('month', now())`). Ahí salen los `pacienteId` reales — la
   API JWT `misPacientes` devuelve una lista parcial y no sirve como universo.
2. **Materializa bajo demanda**: al abrir la ficha de un paciente se trae su
   `detallehistorial` y se hace upsert de paciente + episodios + diagnósticos.
3. **Idempotencia** por identidad externa: `patient.drpro_id`, `episode.drpro_cita_id`,
   `diagnosis.drpro_cita_id`. Reimportar no duplica. `drpro_sync_at` marca la última
   materialización.
4. Las citas **futuras sin ficha** también se espejan, como episodios en estado
   `agendado`, que se completan cuando DrPro las pasa a `Terminada`.

El espejo es *aumentado*: lo que CEPI agrega (imágenes clínicas, clasificación ISIC,
diagnósticos de IA, telemedicina) vive solo en CEPI y nunca vuelve a DrPro.

---

## 22. Portal de casos (`casos.cepi.ec`)

Segunda superficie del frontend médico, hermana de `telemedicina.cepi.ec`. **Comparte
usuarios, auth y componentes**; cambia el propósito.

| | telemedicina.cepi.ec | casos.cepi.ec |
|---|---|---|
| cuándo | con el paciente delante | después, en frío |
| qué hace el médico | llena un caso | revisa, busca, compara |
| conducción | chat que guía el llenado | navegación directa, **sin chat** |
| unidad de trabajo | la visita | el corpus |

No es un tercer frontend. `App.vue` conmuta por un string `view` (no hay `vue-router`),
así que el portal es una rama más y reusa `BotForm`, `EntitySearchField`, `IcdSearchField`,
`ImageGallery` y la sesión. D-Aux-4 queda intacta: los médicos siguen operando en el
frontend médico unificado, no en TodoERP.

### 22.1 Por qué no se construyó sobre el ERP

El ERP ya tiene formulario y lista para las 8 entidades clínicas, generados desde
`entity_definitions`. Aun así no sirve para esto: su formulario es **estructurado por
entidad**, y la ficha clínica es un documento numerado (1.1 Datos de contacto → 4.7
Imágenes → 8 Consentimiento) que cruza `patient` y `episode`. Esa forma ya existe, y no
en el ERP: `FICHA_GROUP_SPEC` en `cepi-bot/src/flowV1.ts` define los **27 grupos** con sus
campos y su entidad destino. El portal la reusa entera.

### 22.2 Qué datos faltan

`fichaBookmarksFor(mcp, {patientId, episodeId})` devuelve, grupo por grupo, si tiene dato.
Era el riel de marcadores del chat; se desacopló de la sesión para que el portal pueda
abrir cualquier ficha por id. `fichaCompleta()` arma los 27 grupos prellenados **en 2
lecturas de entidad**, no en 27, y expone la lista de faltantes.

Esto no es cosmético. Las fichas espejadas de DrPro llenan anamnesis, exploración, plan y
diagnóstico, y dejan **vacíos todos los grupos dermatológicos** (4.x, BLINK) porque el
origen no tiene esos campos (§21.2). Sin el mapa, una ficha importada parece información
perdida en vez de información que nunca existió.

Superficie: `GET /api/bot/ficha?episode_id=&patient_id=` — solo lectura, sin sesión.

### 22.3 Dos búsquedas que no hay que mezclar

| eje | qué permite | corpus |
|---|---|---|
| **Campos de la ficha** (CIE-10, lesión elemental, topografía, edad, sexo) | cohortes: "los casos de este tipo" | los espejados de DrPro + los de CEPI |
| **Embeddings de imagen** (`vectors.search`) | "fotos de casos parecidos" | solo los capturados en CEPI |

`cepi-isic` es un servicio real (`/embed`, `/classify/triage`, `/classify/multiclass`), no
el stub del `models_registry`. Pero **el espejo de DrPro no trae una sola imagen**: de 60
consultas muestreadas, 0 tenían fotos, exámenes ni recetas. Todo lo importado es texto.
La búsqueda visual solo alcanza a lo capturado en CEPI hasta que entre la importación de
fotos por iCloud (pendiente).

### 22.4 Galería y borrado, también acá

Las dos cosas que §24.2.1 define para el iPhone son de las dos superficies, no de la app:

- **Galería** (imágenes de todos los casos de la org, con buscador) e **Imágenes del
  paciente** salen del mismo endpoint, `GET /api/bot/galeria?q=&patient_id=&limit=&offset=`
  (§24.4). El buscador es el de la fila de arriba de §22.3 —campos de la ficha— reducido a
  las cinco cosas con las que un médico reconoce un caso sin abrirlo: nombre, cédula,
  diagnóstico, CIE-10 y fecha. No es la búsqueda por imagen parecida: esa es la segunda
  fila y sigue pendiente.
- **Borrar un paciente** (D-Aux-23) es el mismo `DELETE /api/entities/:id` del ERP, con el
  permiso `entity:<patient>:record:delete` que solo tiene el supermédico. El botón se
  oculta a quien no lo tiene: es la excepción de "nunca ocultes un botón", porque un botón
  muerto por falta de permiso es ruido.

### 22.5 El bot llega después

El portal v1 **no lleva chat**. Cuando llegue, es un **analista sobre el corpus**, no un
llenador: agrupa, compara y responde sobre casos ya registrados. El flujo de slot-filling
(`flowV1`) es de telemedicina y no se invoca acá.


## 23. Informes de patología desde Google Drive

El laboratorio de patología entrega los informes de histopatología como **Google Docs**
en un Drive propio (`cepi.patologia2022@gmail.com`), compartido con CEPI. Cada informe
es una biopsia de un paciente que ya pasó por consulta. Hoy nadie los cruza con la
historia clínica: viven en un Drive y se consultan a mano.

Esta sección define cómo se importan y cómo se cuelgan del episodio correcto.

### 23.1 Superficie de origen

Estructura: `CP POR AÑO / CP <año> / CP <MES> <año> / <documentos>`, años 2019 y 2022→.
Los archivos son Google Docs nativos (no escaneos), nombrados
`CP##### APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2`. `CP#####` es el **correlativo interno de
patología**, no cruza con ningún id de DrPro. `CP COPIA` es la plantilla y se ignora.

El cuerpo del documento trae campos etiquetados, así que **el parseo es determinista —
sin OCR y sin LLM**:

| Etiqueta en el Doc | Destino |
|---|---|
| `Fecha de toma de muestra:` | fecha del episodio (formato `01 DE SEPTIEMBRE DE 2026`) |
| `CP- #####` | `numero_cp`, clave de idempotencia |
| `Paciente:` | control cruzado del nombre |
| `CI:` | **cédula — la clave del match** |
| `Edad:` / `Sexo:` | control cruzado |
| `Diagnóstico Presuntivo:` + `CIE 10:` | diagnóstico de envío (puede traer varios códigos separados por `/`) |
| `Información clínica:` / `Examen físico:` | narrativa clínica |
| `Procedimiento:` / `Muestra:` | qué se tomó y de dónde |
| `Médico que solicita:` | solicitante |
| `Fecha de informe:` | cuándo firmó patología (≠ fecha de toma) |
| `Descripción macroscópica:` / `Descripción microscópica:` | hallazgos |
| `DIAGNÓSTICO:` | **resultado definitivo** |

### 23.2 Acceso: federación, no llaves

La organización `cepi.ec` aplica `iam.managed.disableServiceAccountKeyCreation`, así que
**no hay llave JSON**. El EC2 se autentica con **Workload Identity Federation**: presenta
su rol de instancia de AWS, Google lo cambia por un token de la cuenta de servicio
`cepi-drive-lector@cepi-drive-sync.iam.gserviceaccount.com`, y con ese token lee Drive.

No hay credencial en disco: `/opt/cepi/.secrets.d/gcp-wif.json` solo describe el
intercambio. Una credencial que no existe no se filtra ni se rota.

La Drive API **no acepta identidades federadas directas** — el binding es de suplantación
de cuenta de servicio, restringido al atributo
`aws_role = arn:aws:sts::648395693289:assumed-role/cepi-icloud-sync`.

### 23.3 El match

1. **Paciente por cédula** (`CI:` → `entity_patient.cedula`). Exacto, sin heurística de
   nombres. El nombre del informe se compara solo para detectar incoherencias.
2. **Episodio por fecha de toma de muestra.** Si el paciente tiene un episodio ese día,
   el informe se cuelga de ahí. **Si no hay, se crea el episodio con esa fecha** — la
   biopsia prueba que hubo un encuentro clínico, aunque DrPro no lo haya registrado.
3. **Cédula desconocida → bandeja de revisión.** No se crea el paciente: el universo de
   pacientes lo define el espejo DrPro (§21). Una cédula ausente significa que el espejo
   aún no la trajo o que el informe tiene un error de digitación, y ninguna de las dos se
   arregla creando una ficha nueva.

Se usa la **fecha de toma de muestra**, no la del informe: la toma es el acto clínico; el
informe lo firma patología días después.

Idempotencia por `numero_cp` único. Reimportar no duplica ni pisa lo editado en CEPI.

### 23.3.1 Quién atendió: el informe lo dice y DrPro no

DrPro usa **una sola cuenta para todos los médicos**. Es una de las limitaciones
que motivan esta migración, y tiene una consecuencia directa: en la ficha espejada
no se sabe quién atendió.

El informe de patología trae `Médico que solicita:`. Es de las pocas fuentes que
**nombra al médico**, así que el importador lo resuelve contra los usuarios de
CEPI y atribuye el episodio a esa persona. Exige coincidencia única: con dos
"Ramírez" en la clínica no elige.

Cuando no se resuelve, **el episodio queda sin médico**. No hay respaldo
configurable a propósito: el único candidato a mano sería la cuenta compartida de
DrPro, y atribuirle episodios reproduciría dentro de CEPI justo el problema del que
se está saliendo.

Un episodio sin médico significa que **nadie atendió**, así que tampoco puede
declararse `cerrado`: queda `agendado` —la misma convención que el espejo usa para
las citas sin ficha— y el caso se anota en la bandeja como `medico_no_resuelto`.
Ese motivo no bloquea la importación: el informe entra igual y queda colgado del
episodio; lo que falta es la atribución.

Esto obligó a que `medico_id` dejara de ser obligatorio en el episodio (seed 015).
**Pendiente de modelo**: un episodio puede tener VARIOS médicos, cosa que un campo
escalar no expresa. Eso es un cambio de §11 y no se resuelve acá.

### 23.4 Las imágenes van a S3

Los informes con fotos de histopatología pesan hasta 11 MB. Las imágenes embebidas se
extraen del Doc y se guardan **en S3**, no en el disco del EC2 — una t3.micro con 8.9 GB
libres no es sitio para un archivo de imágenes clínicas que solo crece.

Esto obliga a una capa que hoy no existe. Los adjuntos de TodoERP son
**content-addressed**: `attachmentsRouter` guarda cada archivo como `<sha256>.<ext>` en
`UPLOAD_DIR` y lo sirve estático en `/uploads`. Ese esquema mapea a S3 sin fricción —
la clave del objeto **es** el hash — así que se introduce un adaptador de almacenamiento
con dos implementaciones, `disk` y `s3`, detrás de la misma interfaz
(`put`/`exists`/`stream`/`url`). `STORAGE_BACKEND` elige cuál.

Consecuencias:

- Nada se sirve estático desde S3: el bucket es privado y las descargas van por **URL
  firmada** de vida corta. Son imágenes clínicas (§13.3.1).
- La deduplicación por hash sigue funcionando igual en los dos backends.
- La migración es gradual: lo viejo sigue en disco, lo nuevo entra por S3. El adaptador
  resuelve por existencia, primero el backend activo y después el otro.

### 23.4.1 Las fuentes externas no se tocan: se espejan

Regla general, que §21 ya aplicaba a DrPro y ahora cubre también al Drive de
patología: **CEPI nunca escribe en la fuente**. Ni un campo, ni un renombre, ni un
borrado. Lo que CEPI necesita, lo copia.

Eso duplica el dato clínico —el crudo del informe queda en la base y las imágenes
en S3, además de seguir en el Drive del laboratorio— y la duplicación es
deliberada, no un descuido: es el precio de no depender de un sistema de terceros
para leer una historia clínica, y de poder reprocesar sin volver a bajar nada.

La contrapartida es que el perímetro de datos de pacientes se agranda. Por eso el
bucket es privado con URL firmada, y por eso el crudo va marcado `pii: true`: al
duplicar, las protecciones se duplican con él.

### 23.5 Periodicidad

Un scheduler dentro del backend, con la misma forma que `drproScheduler` (§21): corre
cada `PATOLOGIA_SYNC_CADA_MIN`, lista por `modifiedTime` descendente y procesa lo que
cambió desde la última corrida. Va dentro del proceso y no en un cron del sistema por la
misma razón que el espejo DrPro: el importador firma su JWT desde el id del usuario de
servicio, y un cron externo necesitaría credenciales en disco.

Los informes se corrigen: un Doc puede cambiar después de importado. Por eso la clave de
control es `(numero_cp, modifiedTime)` y no solo el id del archivo.

### 23.6 Qué es escritura inferida y qué no

El match por cédula es **exacto**, no inferido: escribe directo, con
`X-Change-Source: patologia` para que quede en `chatter` de dónde salió (§21).

Lo que sí queda en bandeja, sin tocar la ficha:

- cédula que no existe en CEPI;
- cédula que existe pero el **nombre no coincide** con el del informe;
- documento que no parsea (falta `CI:` o falta `Fecha de toma de muestra:`).


## 24. App nativa iOS (`cepi-ios/`)

La telemedicina se usa con el paciente delante: el médico dicta, fotografía la lesión y
llena la ficha desde el teléfono. En Android eso corre hoy como WebView (Capacitor,
`cepi-frontend/NATIVE.md`); en iOS nunca se empaquetó. Para iPhone y iPad se construye
una app **nativa en SwiftUI** contra el mismo backend. Android sigue el mismo camino en §25.

### 24.1 Por qué SwiftUI (D-Aux-19)

| opción | código que comparte | cómo se siente en iOS | costo |
|---|---|---|---|
| Capacitor iOS | todo el Vue | WKWebView: scroll, teclado y transiciones de página web; arranca cargando el bundle | días |
| React Native | **nada** — Android sigue en Vue | casi nativo, con un runtime JS de por medio | reescritura + un tercer stack |
| **SwiftUI** | nada | nativo: sin runtime intermedio, APIs del sistema directas | reescritura del alcance v1 |

La ventaja de React Native es escribir iOS y Android una sola vez. Con Android fuera del
alcance esa ventaja no existe, y queda una reescritura que igual paga un runtime JS.
Capacitor iOS es lo más barato, pero conserva justo el WebView del que se quiere salir.

SwiftUI además cambia plugins por APIs del sistema: dictado con `Speech` en el
dispositivo (un método del plugin de dictado tumba la app en Android y hubo que
esquivarlo, ver `native/speech.js`), cámara y fotos con `PhotosUI`, JWT en Keychain.
Y no depende de CocoaPods ni de un bundler JS para compilar en la Mac de build.

**Lo que la app nativa no arregla:** la espera del turno del bot es latencia del LLM, no
del WebView. Lo que sí mejora es lo que el médico toca: lista, hilo, teclado, fotos,
arranque y memoria. §24.5 lo convierte en números.

### 24.2 Alcance v1

| entra | queda en la web por ahora (también en Android, §25.2) |
|---|---|
| Login con email y con Google; sesión deslizante; cambio de org activa; eliminar la cuenta | registro y verificación de email |
| Lista de pacientes: búsqueda, alta, "revisar" primero, a cargo | portal de casos (§22) |
| Hilo del paciente por consulta, composer, respuestas rápidas, pendiente sí/no | admin, perfil |
| Fotos (cámara y galería) e imágenes inline con zoom | DoctoPro |
| Ficha: formularios nativos, secciones, auto-form, nueva consulta, derivar | |
| Dictado en español en el dispositivo, manos libres | |
| Push (FCM→APNs), bandeja de notificaciones, abrir el paciente desde la push | |

El visor editable de la ficha (`public/ficha.html`) entra **como documento dentro de un
WKWebView**: es una hoja imprimible con su propia API (`fillFicha`/`readFicha`), no una
pantalla de uso continuo, y reescribirla no mejora nada que se note.

### 24.2.1 Estructura de la app (D-Aux-22, feedback del cliente)

Dos niveles, y en cada uno se pasa de una sección a otra **deslizando**:

| nivel | secciones |
|---|---|
| fuera del paciente | **Pacientes** · **Galería** (imágenes de todos los casos de la org, con buscador) |
| dentro del paciente | **Chat** · **Ficha** · **Imágenes** (las del paciente) |

- **Chat** es el hilo de siempre, con su composer y sus acciones.
- **Ficha** es el visor documental (`ficha.html` en `WKWebView`), que hasta ahora se abría
  desde "Acciones → Ver ficha": se lee completa, marca en rojo lo que cambió respecto de la
  consulta anterior y se imprime. Editar sigue siendo por el chat y por "Secciones", para que
  no haya dos formas distintas de escribir lo mismo.
- **Imágenes** son las fotos clínicas del paciente, de todas sus consultas.
- **Galería** busca por texto: nombre del paciente, cédula, diagnóstico, CIE-10 y fecha. No
  busca por imagen parecida; los embeddings del servicio ISIC quedan para después.

La misma estructura se lleva a la web (§22): mismas secciones, sin gesto de deslizar.

**Borrado de paciente (D-Aux-23).** Un `supermedico` puede borrar un paciente. Es un borrado
**suave** (el registro queda inactivo, como el resto del ERP): la historia clínica no se
pierde y nada que la referencie queda colgando. Si después se crea un paciente con la misma
cédula en la misma organización, **reaparece el registro anterior** en vez de duplicarse. El
botón solo lo ve quien tiene el permiso: es la excepción de la regla de no ocultar botones.

Las dos reglas viven en TodoERP como capacidades **genéricas** que la definición del
paciente enciende (`TodoERP/CLAUDE.md`), no como un caso especial del paciente:
`config.delete_permission` hace que borrar deje de ser parte de editar y exija
`entity:<def>:record:delete` (que solo lleva el bundle `supermedico_perms`), y
`config.natural_key` — la cédula, normalizada a sus dígitos — es la que reencuentra el
registro borrado al volver a darlo de alta: se reactiva, se le completan los campos vacíos
con los nuevos y no se pisa ninguno que ya tuviera dato. Entre orgs no aplica: la misma
cédula en otra organización es otra persona (D-Aux-21), y ahí se crea un registro nuevo.
Mientras está borrado, el paciente no aparece en la lista, la búsqueda, la cola de revisión,
"a cargo", su hilo ni la galería.

### 24.3 Arquitectura

```
cepi-ios/
├── CEPITelemedicina.xcodeproj   carpetas sincronizadas: un .swift nuevo no toca el proyecto
├── CEPITelemedicina/
│   ├── App/             entrada, sesión, pantalla raíz, login
│   ├── API/             cliente HTTP, modelos del contrato, Keychain
│   ├── Pacientes/       lista y alta
│   ├── Chat/            hilo, composer, dictado, adjuntos        (fase 2)
│   ├── Ficha/           formularios nativos y visor ficha.html   (fase 3)
│   ├── Notificaciones/  bandeja y push                           (fase 5)
│   └── Recursos/        Assets (ícono, logo)
└── CEPITelemedicinaTests/   contrato JSON y lógica pura (Swift Testing)
```

- **Sin dependencias de terceros**, salvo `FirebaseMessaging` por Swift Package Manager
  cuando llegue push (el backend ya envía por FCM, `channels/nativePush.ts`). Google
  Sign-In **no** usa el SDK: la hoja de login del sistema (`ASWebAuthenticationSession`)
  con OAuth + PKCE contra un client ID de tipo iOS da el ID token que ya valida el backend.
  Cada dependencia es un plugin más que puede romperse como el de dictado.
- **iOS 17** mínimo (`@Observable`). Swift 6 con concurrencia estricta: la red y el
  decodificado JSON corren fuera del hilo principal; la UI no espera al parser.
- El JWT vive en **Keychain**, no en `UserDefaults`.
- Backend: `https://telemedicina.cepi.ec`. En Debug se cambia sin recompilar con
  variables de entorno: `CEPI_API_BASE` (TodoERP), `CEPI_BOT_BASE` (cepi-bot, que en
  local corre aparte; en producción comparte host bajo `/api/bot`) y `CEPI_WEB_BASE`
  (donde se sirve `ficha.html`; en local, un servidor estático sobre `cepi-frontend/public`).
  El visor carga la hoja desde el servidor y no la empaqueta: una sola copia del documento,
  y un cambio en la web llega a la app sin versión nueva.
  `CEPI_DEV_EMAIL`/`CEPI_DEV_PASSWORD`/`CEPI_DEV_PACIENTE` entran y abren un hilo sin
  tocar la pantalla. Solo existen en Debug.
- **Pruebas en dos niveles**: `CEPITelemedicinaTests` (contrato JSON con respuestas reales
  capturadas del backend, y la lógica pura) y `CEPITelemedicinaUITests`, que recorre la
  app contra el stack local con datos ficticios y se salta sin él. Nunca contra producción:
  hay PII real.
- **"Nunca ocultes un botón"** vale igual acá: `.disabled` más una explicación visible,
  no un `if`. Ejemplo: con una sola organización, el selector aparece gris y dice "única
  organización de tu cuenta".
- Los formularios de la ficha **vienen del servidor** (`form` en la respuesta del chat,
  `FICHA_GROUP_SPEC` en `flowV1.ts`). La app conoce los 10 tipos de campo de `BotForm.vue`
  (`text`, `textarea`, `date`, `checkbox`, `radio`, `heading`, `entity_search`,
  `icd_search`, `body_map`, `image_upload`). Un campo nuevo de un tipo conocido no pide
  versión nueva de la app; un **tipo** nuevo sí, y mientras tanto se pinta como texto,
  igual que hace la web.

### 24.4 Contrato con el backend

Todo lo que consume la app lo usa también la web. Salvo dos piezas genéricas (Google con
varios client IDs y el borrado de cuenta, abajo), ya existía:

| función | endpoint | servicio |
|---|---|---|
| login | `POST /api/auth/login` → `{token, user}` | TodoERP |
| Google | `POST /api/auth/google {credential}` | TodoERP |
| sesión deslizante | `GET /api/auth/me` → `{token, user}` (JWT de 8 h, se reemite) | TodoERP |
| org activa | `POST /api/orgs/switch {org_id}` → `{token}` | TodoERP |
| borrar la cuenta propia | `DELETE /api/auth/me {confirm: true}` → `{ok: true}`; 400 sin la confirmación, 409 si es el último super-admin activo | TodoERP |
| pacientes | `GET/POST /api/entities` (`entity_id=11000000-…`) | TodoERP |
| "revisar" y a cargo | `GET /api/review-queue`, `GET /api/patient-assignments` | TodoERP |
| hilo | `GET /api/patient-thread?patient_id=` | TodoERP |
| turno | `POST /api/bot/chat {message, session_id, form_submission}` | cepi-bot |
| sesiones propias | `GET /api/bot/sessions?patient_id=` | cepi-bot |
| galería e imágenes del paciente | `GET /api/bot/galeria?q=&patient_id=&limit=&offset=` → `{ok, data:[{id, attachment_id, patient_id, paciente, cedula, episode_id, fecha, diagnostico, codigo_cie10, body_region, privada}], total}` | cepi-bot |
| borrar un paciente | `DELETE /api/entities/:id` → 403 sin `entity:<patient>:record:delete` | TodoERP |
| destinos de derivación | `GET /api/groups`, `GET /api/groups/:slug/members` | TodoERP |
| adjuntos | `POST /api/attachments` (multipart), `GET /api/attachments/:id/file` | TodoERP |
| CIE-10 | `GET /api/icd10/search?q=` | TodoERP |
| notificaciones | `GET /api/reminders`, `POST /api/reminders/:id/complete`, `GET /api/review-queue/patient/:entityId` | TodoERP |
| push | `POST/DELETE /api/push/device-token {platform:'ios', token}` | TodoERP |

Un token vencido o inválido responde **401** (`authMiddleware.ts`); un permiso que falta,
**403**. Un token bien firmado de una cuenta **inactiva o borrada** también es 401, desde el
request siguiente al borrado y no cuando vence (`isUserActive`, §24.7); si la base no
responde a esa consulta, **503**, para que un pico no cierre la sesión de todos. La app cierra sesión solo ante un 401 de una llamada que llevaba token: un 403
dice "no podés hacer esto", no "no sos vos".

Tras cada turno la app **relee el hilo** en vez de pintar el `text` de la respuesta, igual
que `IntakeChat.vue`: así el iPhone y la web muestran exactamente el mismo hilo.

**Google Sign-In:** el ID token de la app trae como `aud` el client ID de iOS, no el de la
web. Cambio de backend genérico: `GOOGLE_CLIENT_ID` acepta varios IDs
separados por coma (`allowedGoogleAudiences` en `authService.ts`). En producción hay que
agregar el de iOS a esa variable.

### 24.5 Rendimiento: qué se mide

"Mejor rendimiento" sin números es una opinión. Estos objetivos se miden con Instruments
en un **iPhone real**, no en el simulador de la Mac Intel, y se recalibran con la primera
medición:

| métrica | objetivo inicial |
|---|---|
| arranque en frío con sesión → lista visible | < 1 s (los datos llegan después, sin bloquear) |
| scroll de la lista (500 pacientes) y de un hilo largo | sin *hitches* perceptibles (< 5 ms/s) |
| enviar mensaje → eco en pantalla | inmediato (optimista) |
| hilo con 50 imágenes | < 150 MB de memoria |

Decisiones que salen de acá: la lista pide pacientes, "revisar" y a cargo **en paralelo**
(la web lo hace en serie); el texto de búsqueda se normaliza una vez por carga, no por
tecla; las imágenes autenticadas pasan por un cargador propio con caché (`AsyncImage` no
manda el header `Authorization`).

### 24.6 Push

- `FirebaseMessaging` obtiene el token FCM y lo registra con `platform: 'ios'`. APNs va
  por la llave `.p8` subida a Firebase (ya documentado en `NATIVE.md`).
- Tocar la notificación: `data.entity_id` → `GET /api/review-queue/patient/:entityId` →
  abre el hilo del paciente. Sin portal de casos en v1, el destino es siempre el paciente.
- Con la app abierta: banner y vibración, **sin sonido** — el mismo criterio que Android
  (`native/push.js`), porque se usa en consulta.
- Al cerrar sesión se borra el token (`DELETE /api/push/device-token`), para que las
  derivaciones no le lleguen al teléfono de otro.

### 24.7 Distribución y revisión de Apple

- Bundle id **`ec.cepi.telemedicina`**, el mismo de `capacitor.config.ts` y de Firebase.
  El proyecto iOS de Capacitor nunca se generó, así que no hay nada que migrar.
- TestFlight → App Store. **No hay OTA**: la app nativa se actualiza por la tienda. Lo que
  cambia seguido (los formularios de la ficha) ya viene del servidor (§24.3).
- La app es **cerrada para el negocio**, no pública:
  1. **TestFlight interno** primero: hasta 100 usuarios del equipo de App Store Connect,
     sin revisión de Apple.
  2. **TestFlight externo** si los médicos no son parte del equipo: pasa Beta App Review.
  3. **Unlisted App Distribution** para quedarse: revisión normal, no aparece en búsquedas,
     se instala solo con el enlace.

  El acceso real lo sigue decidiendo el backend (cuenta nueva = rol `pendiente`).
- La **cuenta demo** que pide Apple para revisar vive solo en la org de pruebas
  (`cepi-testing`), nunca en `cepi`: el revisor entra a producción. `cepi-testing` es una
  **org sandbox** (D-Aux-21, §13.7): la cuenta demo ve solo los 6 pacientes ficticios del
  seed 017 (y lo que ella misma cree), ni un paciente, imagen o informe de otra org, no abre
  DrPro ni DoctoPro, y solo puede derivar a miembros de `cepi-testing`.
  - **Qué hace el deploy** (CI, `docs/DEPLOY.md`): aplica 021 y la cascada de seeds desde el
    primero que cambió (014 en adelante) en una transacción, reinicia y re-aplica. En el
    primer deploy: 014 pasa el índice de patología a
    `(org_id, numero_cp)`; 017 depura una vez la membresía de `cepi-testing` (y saca a los demo de 007); 018 crea
    `cepi-drpro`, copia membresías una vez, reparte los datos y devuelve a su org las filas
    de la sandbox que apuntan a pacientes reales. En los siguientes: nada de lo de una vez
    se repite, y lo repetible solo encuentra lo que haya quedado mal ubicado.
  - **Pendiente en producción (no se hace desde el código), en este orden:**
    1. Antes del deploy, correr la consulta previa de §13.7 y revisar los conteos (quién
       escribe como espejo DrPro, cuántos mixtos se van a partir, filas de la sandbox que
       vuelven a su org, quiénes salen de `cepi-testing`). Un push a `ci/<algo>` muestra el
       ensayo del SQL pendiente.
    2. Después del deploy, revisar las membresías de `cepi-drpro`: el seed copió a todos los
       de `cepi`; sacar a quien no trabaja en el consultorio.
    3. Poner `REGISTER_DEFAULT_ORG_SLUGS=cepi` (el código ya ignora las sandbox, pero la
       variable debe decir lo que se quiere).
    4. Si telemedicina usa la búsqueda de DoctoPro del intake, agregar `doctopro` a las
       features de `cepi` (hoy solo está en `cepi-drpro`).
    5. La membresía de `cepi-testing` es manual desde la depuración. Para que la derivación
       se pueda mostrar, agregar a la sandbox al menos un colega que solo exista en ella, en
       algún grupo: con la cuenta demo sola, "Todos" y los círculos resuelven a nadie.
- `Recursos/PrivacyInfo.xcprivacy` declara el uso de `UserDefaults` (razón `CA92.1`) y los
  datos que maneja, todos para el funcionamiento de la app y sin rastreo. Sin la
  declaración de `UserDefaults`, App Store Connect rechaza la build.
  `ITSAppUsesNonExemptEncryption = NO`: solo HTTPS y el hash de PKCE, así que no pregunta
  por cifrado en cada build.
- App de salud: Apple revisa con más rigor (guías 1.4.1 y 5.1.1). El login con Google
  *crea* cuentas (find-or-create en `loginWithGoogle`), y Apple exige que una app que crea
  cuentas permita **borrarlas desde la app** (5.1.1(v)); Google Play pide lo mismo.
  **Resuelto** con el borrado de cuenta (D-Aux-20, abajo).
- **Borrado de cuenta (D-Aux-20).** `DELETE /api/auth/me {confirm: true}`, en "Cuenta →
  Eliminar cuenta" de la app, en "Mi perfil" de la web (y así en la APK) y en la pantalla
  de cuenta pendiente, que es donde cae una cuenta recién creada con Google. La
  confirmación dice qué se borra y que las historias clínicas se conservan.
  - **Las historias clínicas no se borran.** Pertenecen al paciente y a la institución, y la
    ley obliga a conservarlas. Se borra la **cuenta**, no lo que la persona registró: el `id`
    del usuario se queda, así que `created_by`, `chatter`, adjuntos, relaciones y demás
    referencias siguen íntegras.
  - En una transacción (`accountDeletionService.ts`, genérico): email → `deleted-<id>` (sin `@`: inválido, único, no bloquea volver a
    registrarse); contraseña vacía; `data` entero fuera (teléfono, cédula, `google_sub`,
    Telegram/WhatsApp, códigos de verificación, permisos directos); sin rol; inactiva. Se
    borran membresías de organización y de grupo, tokens de push nativo y suscripciones
    web push. Los permisos temporales vigentes se revocan y los recordatorios pendientes
    de la persona se cancelan; el historial de ambos se conserva. La proyección del usuario
    como entidad (migración 020) sigue al cambio por su trigger.
  - Con el mismo email o la misma cuenta de Google se puede volver a entrar: es una cuenta
    **nueva**, en `pendiente`.
  - **El JWT deja de valer enseguida.** `verifyToken` y `optionalAuth` preguntan
    `isUserActive` antes de aceptar un token. La respuesta se cachea 10 s, igual que los
    permisos, y el borrado (y el `PATCH` de admin) invalida esa entrada: en el proceso que
    atendió el borrado el corte es inmediato. Con varias instancias del backend el resto
    tardaría hasta 10 s; hoy corre una sola. De paso, desactivar a alguien desde admin
    también corta sus tokens vigentes.
  - **Guarda:** si es el último super-admin activo (`*:*:*:*` por `allow_grant_all` o por el
    permiso literal) responde **409** y no borra. Los borrados se serializan con un
    advisory lock para que dos admins no se borren a la vez.
  - **El nombre se conserva.** Los registros guardan al profesional por id (`medico_id`,
    `responsable_actual_id`, autor del `chatter`), y la historia clínica tiene que seguir
    diciendo quién atendió; la misma obligación legal de conservarla es base para retener
    el nombre. Anonimizarlo se puede decidir después; borrado, no se recupera.
- La Mac de build es Intel. macOS 26 es la última versión con soporte Intel: sirve para
  compilar y subir mientras el Xcode que exija Apple corra en macOS 26. Conviene prever
  una Mac con Apple Silicon antes de ese límite.

### 24.8 Cuentas, en el orden en que hacen falta

| cuándo | qué | para qué |
|---|---|---|
| fases 0–1, simulador | nada | compila y corre sin firmar |
| fase 1, iPhone propio | Apple ID en Xcode (el equipo personal gratuito alcanza) | instalar en un dispositivo |
| fase 4 | Google Cloud: client ID **iOS** en el proyecto del OAuth web actual | login con Google |
| fase 5 | **Apple Developer Program** (USD 99/año) + llave APNs `.p8`; Firebase: app iOS y `GoogleService-Info.plist` | push (el equipo gratuito no permite push) |
| fase 6 | App Store Connect: ficha de la app, política de privacidad (`privacidad.html` ya existe) | TestFlight y tienda |

### 24.9 Fases

| fase | entrega | se da por hecha cuando |
|---|---|---|
| 0 | esta sección + esqueleto `cepi-ios/` | compila y los tests de contrato pasan en simulador |
| 1 | login, sesión en Keychain, cambio de org, lista de pacientes y alta | un usuario demo entra y ve su lista contra el backend real |
| 2 | hilo por consulta, composer, pendiente sí/no, respuestas rápidas, fotos, imágenes con zoom | un turno enviado desde el iPhone aparece igual en la web |
| 3 | ficha: formularios nativos, secciones, auto-form, nueva consulta, derivar, visor | se llena una ficha completa desde el iPhone |
| 4 | dictado en el dispositivo + Google Sign-In | se dicta en español en modo avión |
| 5 | push, bandeja, abrir desde la notificación | una derivación hecha en la web llega al iPhone y tocarla abre el paciente |
| 6 | cola offline, borrado de cuenta (hecho, §24.7), TestFlight | la build se distribuye por TestFlight |


## 25. App nativa Android (`cepi-android/`)

La APK de hoy (`cepi-frontend/android`, Capacitor) es el WebView del que iOS ya salió
(§24). Android pasa a una app **nativa en Kotlin con Jetpack Compose**, contra el mismo
backend y con el alcance de la app iOS. La APK Capacitor sigue publicada hasta que la
nativa la reemplace en Play (§25.7).

### 25.1 Por qué Kotlin + Compose (D-Aux-24)

| opción | qué comparte con iOS | cómo corre en Android | costo |
|---|---|---|---|
| Capacitor (la APK actual) | — | WebView: scroll, teclado y transiciones de página web; plugins para lo nativo | ya existe |
| Flutter | nada | motor propio que pinta sus widgets; teclado, texto y accesibilidad no son los del sistema | reescritura + Dart, un tercer stack |
| React Native | nada | runtime JS de por medio | reescritura + un tercer stack |
| Kotlin Multiplatform | ~1.100 líneas (`API/`, `LogicaFormulario`) | nativo | iOS tendría que consumir un framework Kotlin/Native en lugar de su capa de red ya probada, y la Mac Intel de build sumaría el toolchain de Kotlin |
| **Kotlin + Compose** | nada de código; sí el contrato | nativo: sin runtime intermedio, APIs del sistema directas | reescritura del alcance v1 |

La ventaja de un framework multiplataforma es escribir las dos apps una vez. iOS ya está
escrita y probada en SwiftUI (D-Aux-19), así que esa ventaja ya no existe. Lo que se
comparte es el **contrato**: los tests de Android decodifican los mismos JSON que
`ContratoTests` y fijan las mismas reglas que `SesionTests` y `PacientesTests`. Si el
backend cambia una clave, fallan las dos suites.

Compose en lugar de Views: en release, con R8 y Baseline Profile, rinde igual, y su costo
(el JIT del primer arranque) es justo lo que el Baseline Profile resuelve. Además se
traduce casi 1:1 desde SwiftUI: `@Observable` → `mutableStateOf`, `async let` → `async`,
`Codable` → `kotlinx.serialization`.

Como en iOS, los plugins se reemplazan por APIs del sistema: dictado con
`android.speech.SpeechRecognizer` (el plugin actual tumba la app con un método,
`native/speech.js`), Google con Credential Manager, fotos con Photo Picker y
`TakePicture`, push con Firebase Messaging directo.

### 25.2 Alcance v1

El de iOS (§24.2 y §24.2.1): Pacientes · Galería afuera; Chat · Ficha · Imágenes dentro del
paciente, deslizando. Registro y verificación de email, portal de casos, admin, perfil y
DoctoPro **quedan en la web**. La APK Capacitor los tiene porque carga todo el frontend;
al reemplazarla salen de la app Android. Aceptado el 2026-09-21.

También se pierde el OTA de `@capgo/capacitor-updater`: la app nativa se actualiza por
Play. Lo que cambia seguido (los formularios de la ficha) ya viene del servidor (§24.3).

### 25.3 Arquitectura

```
cepi-android/
├── settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml
└── app/src/
    ├── main/java/ec/cepi/telemedicina/
    │   ├── app/          entrada, sesión, raíz, login, cuenta pendiente, menú de cuenta
    │   ├── api/          cliente HTTP, modelos del contrato, credenciales cifradas
    │   ├── pacientes/    lista, alta, borrado y el paciente abierto (Chat · Ficha · Imágenes)
    │   ├── chat/         hilo, composer, fotos, imágenes autenticadas y visor con zoom
    │   ├── ficha/        visor ficha.html, formularios del bot, secciones y derivar
    │   ├── galeria/      galería de la org e imágenes del paciente
    │   └── notificaciones/ bandeja y push                          (fase 5)
    ├── release/generated/baselineProfiles/   el perfil generado, versionado
    ├── debug/            red en claro solo hacia el stack local
    └── test/             contrato JSON y lógica pura (JUnit en la JVM, sin emulador)
baselineprofile/          recorrido UiAutomator que genera el Baseline Profile (§25.5)
```

- **Toolchain:** AGP 9, Kotlin 2.4, Compose BOM 2026.09, JDK 21. `minSdk 24` (el mismo de la
  APK, para no dejar afuera a nadie que ya la tiene) con desugaring de `java.time`;
  `targetSdk 36`; `compileSdk 37`, que exigen las versiones actuales de AndroidX y OkHttp.
- **Dependencias mínimas:** AndroidX (Compose, Material 3, Activity, Lifecycle),
  `kotlinx.serialization`, `kotlinx.coroutines` y OkHttp. Después, una por fase: Coil
  (imágenes, fase 2), Credential Manager (fase 4), Firebase Messaging (fase 5). Sin
  Retrofit, sin Hilt, sin librería de navegación: son dos niveles de pantallas y un
  `Sesion` compartido. Igual que en iOS, cada dependencia es un plugin más que puede romperse.
- **Red y parseo fuera del hilo principal** (`Dispatchers.IO` y `Default`): la UI recibe el
  resultado ya armado. OkHttp ya reintenta sobre una conexión reusada que el servidor
  cerró por inactividad; en iOS eso hubo que hacerlo a mano (`pedirConReintento`).
- **JWT cifrado** con una llave AES-GCM del Android Keystore, que no sale del hardware. El
  texto cifrado vive en `noBackupFilesDir` y la app declara `allowBackup="false"`: ni backup
  ni restauración en otro teléfono, igual que `ThisDeviceOnly` en el Keychain.
  `EncryptedSharedPreferences` no se usa: está deprecada.
- **Imágenes clínicas** con Coil sobre el mismo `OkHttpClient` de la API. Un interceptor pone
  el Bearer solo si el pedido va al host del backend. Caché **solo en memoria**, como en iOS:
  ninguna foto clínica queda en el disco. Al subir, la foto se decodifica al tamaño final
  (`ImageDecoder` en Android 9+, `inSampleSize` antes), sale enderezada y se reescribe como
  JPEG sin EXIF: sin GPS ni modelo de cámara. La cámara es la del sistema (`TakePicture` +
  `FileProvider` en la caché, se borra al subir); la app no pide permiso de cámara.
- Backend: `https://telemedicina.cepi.ec`. En **debug** se cambia sin recompilar con extras
  del intent, los mismos nombres que en iOS: `CEPI_API_BASE`, `CEPI_BOT_BASE`,
  `CEPI_WEB_BASE`, `CEPI_DEV_EMAIL`/`CEPI_DEV_PASSWORD` (entra solo) y `CEPI_DEV_PACIENTE`.
  Desde el emulador, el stack local es `10.0.2.2`; desde un teléfono, `adb reverse` y
  `127.0.0.1`. La red en claro solo se permite hacia esos hosts y solo en debug
  (`src/debug/res/xml/network_security_config.xml`). En release los extras se ignoran
  (`BuildConfig.ENTORNO_CONFIGURABLE`). Las variantes de medición (`nonMinifiedRelease`,
  `benchmarkRelease`) los aceptan porque corren contra el stack local; no se publican.
- **Ficha** en un `WebView` que solo navega dentro del host de la web. La hoja mide 210 mm
  sin viewport: se diagrama ancha y se muestra entera (`useWideViewPort` +
  `loadWithOverviewMode`), con zoom. Fuera de su pestaña el `WebView` queda invisible: dentro
  del pager se dibujaba encima del chat aunque su página estuviera corrida.
- **Pruebas:** tests JVM de contrato y de lógica (`./gradlew testDebugUnitTest`). El
  servidor falso es un interceptor de OkHttp (`ServidorFalso`, igual que el de iOS sobre
  `URLProtocol`): sin sockets ni dependencias de test. Nunca contra producción: hay PII real.
- **"Nunca ocultes un botón"** vale igual: `enabled = false` más un texto que diga por qué.
- Los formularios de la ficha vienen del servidor, con los mismos 10 tipos de campo y el
  mismo criterio para un tipo desconocido (§24.3). Se abren en una hoja inferior con el
  botón de guardar en su barra: el teclado no lo tapa. El auto-form es de cada paciente y se
  guarda en las preferencias de la app, que tampoco viajan en backups (`data_extraction_rules`).

- **Dictado** con `SpeechRecognizer`, creado y usado en el hilo principal (el plugin de la APK
  lo hacía fuera y tumbaba la app). Prefiere el motor en el dispositivo (Android 12+), que
  funciona en modo avión. Prueba variantes de español en orden: la del teléfono, es-EC, es-US y
  es-ES; los motores locales suelen traer solo es-US y es-ES, y a es-EC responden "idioma no
  soportado". Si la variante existe pero no está bajada, le pide la descarga al sistema
  (`triggerModelDownload`, Android 13+) y mientras tanto dicta por red. En Android 13+ la
  sesión es segmentada (un tramo por pausa, sin reiniciar ni pitar); antes se relanza sola al
  terminar cada frase. El micrófono se suelta al salir o al pasar a segundo plano.
- **Google** por Credential Manager (`GetSignInWithGoogleOption` con el client ID web): la
  hoja de cuentas del sistema, sin WebView ni plugin. Debug y release se firman con la clave
  de subida (`keystore.properties`, fuera de git): el cliente OAuth Android de Google Cloud
  tiene registrada esa huella y sin ella no hay token.

### 25.4 Contrato con el backend

El de §24.4, sin endpoints nuevos. Dos diferencias:

- **Push:** `POST/DELETE /api/push/device-token {platform: 'android', token}`, lo mismo
  que manda hoy la APK.
- **Google:** Credential Manager pide el ID token con `serverClientId` = el client ID
  **web**, así que `aud` es el web y el backend no cambia. Es lo que ya hace la APK con
  el plugin de capgo. No hace falta un client ID Android en `GOOGLE_CLIENT_ID`. Sí hace
  falta el client ID Android en Google Cloud (paquete + SHA-1 de la firma) para que
  Credential Manager responda.

### 25.5 Rendimiento: qué se mide

Mismos objetivos que §24.5, medidos con **Macrobenchmark** en un **teléfono real de gama
media** (el Xiaomi del equipo), sobre la build `benchmark` (release sin firmar). Compose en
debug es varias veces más lento que en release: una medición en debug no vale.

| métrica | cómo | objetivo inicial |
|---|---|---|
| arranque en frío con sesión → lista visible | `StartupTimingMetric` (`reportFullyDrawn` al pintar la lista) | < 1 s |
| scroll de la lista (500 pacientes) y de un hilo largo | `FrameTimingMetric` | `frameOverrunMs` P95 ≤ 0 |
| enviar mensaje → eco en pantalla | eco optimista | inmediato |
| hilo con 50 imágenes | `dumpsys meminfo` | < 150 MB |

Decisiones que salen de acá, además de las de iOS (carga en paralelo, texto de búsqueda
normalizado una vez por carga, imágenes autenticadas con caché):

- R8 con `isMinifyEnabled` e `isShrinkResources` en release. La APK Capacitor sale sin
  minificar.
- **Baseline Profile** generado desde el recorrido login → lista → paciente → galería
  (`baselineprofile/GeneradorPerfil.kt`) contra el stack local, versionado en
  `app/src/release/generated/baselineProfiles/` e instalado con `profileinstaller`. Se
  regenera con `./gradlew :app:generateBaselineProfile` cuando cambia una pantalla del recorrido.
- El hilo es una `LazyColumn` invertida: arranca en el último mensaje. Ante un turno nuevo baja
  al final, porque la lista conserva el ítem que estaba a la vista y lo nuevo quedaba debajo.
- `LazyColumn` con `key = id` y filas precalculadas: una recomposición no recalcula
  iniciales ni la clave de búsqueda.
- Coil sobre el mismo `OkHttpClient`: manda `Authorization` y decodifica al tamaño del
  composable, no al de la foto.

### 25.6 Push

Mismo criterio que §24.6: Firebase Messaging registra el token con `platform: 'android'`;
tocar la notificación abre el paciente (`data.entity_id` →
`GET /api/review-queue/patient/:entityId`); con la app abierta, vibración sin sonido (se
usa en consulta); al cerrar sesión se borra el token. En Android 13+ el permiso de
notificaciones se pide en tiempo de ejecución. `google-services.json` es el mismo de la APK
(mismo paquete) y sigue fuera de git.

- Dos canales: **Derivaciones** (con sonido, lo pinta el sistema con la app cerrada: es el canal
  por defecto de FCM) y **Derivaciones con la app abierta** (vibración, sin sonido).
- El token se registra cada vez que la sesión queda activa y se borra **antes** de soltar la
  sesión; si fuera después, el DELETE saldría sin Bearer. Al borrar la cuenta no se llama: el
  backend ya borró sus tokens.
- Tocar la notificación: el sistema pone el `data` del push en los extras (`entity_id`);
  `MainActivity` es `singleTop` y lo lee en `onCreate` o `onNewIntent`, y `Principal` abre el
  paciente con `GET /api/review-queue/patient/:entityId`. Con la app cerrada espera a que se
  restaure la sesión.
- Bandeja: la campana de la barra con el número de avisos sin ver; la lista de
  `GET /api/reminders` del usuario, "Visto" (`POST …/complete`) y tocar un aviso abre su paciente.
  Se refresca al volver a primer plano, cada minuto y al llegar un push.
- Sin `google-services.json` al compilar, la app no aplica el plugin de Google Services y el
  menú de la cuenta dice "esta compilación no tiene Firebase".

### 25.7 Distribución en Play

- Paquete **`ec.cepi.telemedicina`**, la misma ficha de Play Console que la APK (cuenta
  Cempiel). La app nativa sube como **una versión nueva de la misma app**: quien tiene la
  APK la recibe como actualización, sin desinstalar. `versionCode` 3 o más (la APK va en 2).
- Se firma con la misma clave de subida (`cepi-release.keystore`, fuera de git). Si la
  clave se pierde, Play App Signing permite resetear la clave de subida; sin la clave no
  se publica.
- Pista de prueba interna → producción. La cuenta demo para la revisión es la de la
  sandbox `cepi-testing` (§24.7). El borrado de cuenta desde la app, que Play también
  exige, entra en la fase 1.
- Data safety y la declaración de app de salud se revisan antes de subir: la app nativa
  maneja los mismos datos que la APK.
- `cepi-frontend/android/` y el OTA (`/api/ota/latest`) se retiran cuando la nativa esté en
  producción con las fases 1–5 completas. Hasta entonces la APK Capacitor es la que se
  publica.

### 25.8 Fases

| fase | entrega | se da por hecha cuando |
|---|---|---|
| 0 | esta sección + esqueleto `cepi-android/` | `assembleDebug` compila y `testDebugUnitTest` pasa |
| 1 | login con email, sesión cifrada, cambio de org, lista de pacientes, alta, borrado (supermédico), eliminar la cuenta, cuenta pendiente | un usuario demo entra y ve su lista contra el stack local |
| 2 | paciente (Chat · Ficha · Imágenes), hilo por consulta, composer, pendiente sí/no, respuestas rápidas, fotos, imágenes con zoom, Galería; Baseline Profile | un turno enviado desde Android aparece igual en la web |
| 3 | ficha: formularios nativos, secciones, auto-form, nueva consulta, derivar, visor | se llena una ficha completa desde Android |
| 4 | dictado en el dispositivo + Google Sign-In | se dicta en español en modo avión (Android 12+ con el idioma descargado) |
| 5 | push, bandeja, abrir desde la notificación | una derivación hecha en la web llega al teléfono y tocarla abre el paciente |
| 6 | Macrobenchmark contra §25.5, release firmado, pista interna de Play | la app nativa reemplaza a la APK Capacitor en la pista interna |


---

**Fin del documento.**

**Estado actual (2026-05-06):** decisiones D-1 a D-15 + D-Aux-1 a D-Aux-14 **resueltas** en cuestionario inicial. Listos para iniciar Fase 0.

**Próximos pasos:**
1. Limpieza del repo raíz (carpetas espurias `D:cepibackend`, etc.).
2. Levantar TodoERP local con Postgres + `pgcrypto` + `pgvector`.
3. Crear rama `feat/medical-assistant`.
4. Empezar Fase 1 (capacidades genéricas: alertas + vector + break-glass + revisión).
