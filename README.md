# cepi — asistente médico conversacional sobre TodoERP

Repositorio mono que agrupa cuatro componentes que trabajan juntos:

| Carpeta | Qué es | Puerto |
|---|---|---|
| `TodoERP/` (repo aparte) | ERP polimórfico genérico — datos, permisos, MCP server | backend `:3001`, frontend admin `:5173` |
| `cepi-bot/` | Agente conversacional médico que consume TodoERP vía MCP | `:3002` |
| `cepi-frontend/` | UI de chat para médicos / pacientes / guests | `:5174` |
| `backend/` (legacy) | Chatbot CEPI original (DeepSeek + tree.js). Sin PM2; será reemplazado | — |

Toda la arquitectura, decisiones y plan de fases están en [`docs/PAPER.md`](docs/PAPER.md).
Estado actual de fases en [`docs/STATUS.md`](docs/STATUS.md). Manual de operaciones (backup, restore, runbook, hardening) en [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
La deuda técnica resuelta de TodoERP en [`TodoERP/docs/REFACTOR_PLAN.md`](TodoERP/docs/REFACTOR_PLAN.md).

---

## Quick start (Windows + WSL Ubuntu)

Requisitos:

- Windows 10/11 con WSL2 + distro Ubuntu instalada.
- Node.js (Windows). Funciona con la 22.x; el binario se invoca tanto desde Windows (PM2) como desde WSL (vitest, scripts).
- PostgreSQL 16 dentro del WSL Ubuntu (no en Windows). El proyecto usa `localhost:5432` y la WSL2 lo expone al host automáticamente.
- Extensión `pgvector` instalada (`apt install postgresql-16-pgvector`).
- PM2 global en Windows (`npm i -g pm2`).

### 1. Clonar

TodoERP es un repo privado e independiente que vive dentro de la carpeta de cepi
(cepi lo ignora en `.gitignore`). Se clonan los dos:

```powershell
git clone git@github.com:desarrollocepi/cepi.git
cd cepi
git clone git@github.com:desarrollocepi/TodoERP.git TodoERP
```

### 2. Bases de datos

```bash
# en WSL Ubuntu, primer arranque
sudo service postgresql start
sudo -u postgres createuser -s postgres   # si aún no existe
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'cerebro';"
sudo -u postgres createdb cepi
```

Aplicar schema + migraciones + seeds + datos médicos:

```bash
bash scripts/reset-cepi.sh                 # base + medical
bash scripts/reset-cepi.sh --with-fake-data  # opcional: 50 pacientes ficticios
```

`reset-cepi.sh` compone el reset upstream de `TodoERP` (`reset-db.sh`,
schema + Phase 1 capacidades + permisos genéricos) y luego encadena
las semillas médicas.

### 3. Dependencias

```powershell
cd TodoERP\backend && npm install && cd ..\..
cd TodoERP\frontend && npm install && cd ..\..
cd TodoERP\mcp && npm install && npx tsc && cd ..\..
cd cepi-bot && npm install && npx tsc && cd ..
cd cepi-frontend && npm install && cd ..
```

### 4. Levantar todo con PM2

```powershell
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
```

URLs:

- TodoERP admin: <http://localhost:5173> (admin@erp.com / Admin123!)
- Frontend médico: <http://localhost:5174> (mismo login para empezar)
- Bot HTTP: <http://localhost:3002/health>
- TodoERP API: <http://localhost:3001/health>

---

## Variables de entorno relevantes

| Var | Quién la lee | Para qué |
|---|---|---|
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | TodoERP backend | conexión Postgres |
| `STAGE` | TodoERP backend | `DEVELOP` activa relajaciones (rate limit alto, super-admin re-validación, security-report header) |
| `JWT_SECRET` | TodoERP backend | firma de tokens; obligatorio fuera de DEVELOP |
| `CORS_ORIGINS` | TodoERP backend | lista coma-separada con soporte de glob (`https://*.staging.example.com`) |
| `CEPI_MEDICAL` | TodoERP backend | `1` registra los hooks médicos (`episode_close_followup` y futuros) |
| `TODOERP_API_URL` / `TODOERP_JWT` / `TODOERP_API_KEY` | cepi-bot, MCP | a quién y cómo conectarse al ERP |
| `CEPI_LLM_PROVIDER` | cepi-bot | `stub` (default) o `deepseek` |
| `DEEPSEEK_API_KEY` | cepi-bot (cuando provider=deepseek) | obvio |
| `CEPI_GUEST_API_KEY` | cepi-bot | API key fallback para chat anónimo |

---

## Mapa de capacidades (estado actual)

### TodoERP (repo aparte, `desarrollocepi/TodoERP`)

- ✅ Polymórfico `entities` + `entity_<slug>` con sync trigger (R1).
- ✅ FK cross-type sobre `entities(id)` (R2).
- ✅ Validación de schema en escritura (R3, opt-in `validate_strict`).
- ✅ Redacción de PII en respuestas (R4, perm `pii:read:<slug>`).
- ✅ `roles.allow_grant_all` en lugar del hardcoded admin name (R8).
- ✅ Lifecycle hooks por `entity_definition` (R6).
- ✅ Tests aislados sin prefijo `TEST_` (R7).
- ✅ CORS con globs (R10).
- ✅ Phase 1 generic: reminders, temporary permissions, vector store, request_review, MCP server.
- ✅ entityTableService (per-type tables + reconcile).

### cepi (branch `feat/medical-assistant`)

- ✅ Documento de proyecto (`docs/PAPER.md`).
- ✅ Datos clínicos seeded: 9 entity_definitions, roles, permisos §13.1, ISIC stubs, forms+navs, 50 pacientes / 150 episodios / 80 dx / 120 imágenes / 240 clasificaciones / 200 reminders.
- ✅ CIE-10 dermatología subset (37 códigos).
- ✅ Hook `episode_close_followup`: cerrar episodio con `proximo_control_fecha` crea reminder.
- ✅ Bot conversacional (cepi-bot): MCP loop, sesión persistente como `bot_session`, paciente/episodio activo, subida de imagen → `clinical_image` automático cuando hay episodio activo.
- ✅ DeepSeek adapter listo (env-driven).
- ✅ Frontend de chat (cepi-frontend) con tabla para tool results.

### Pendiente / próximo (per `docs/PAPER.md` §15)

- Fase 5 fina: slot filling guiado por LLM, confirmación obligatoria antes de persistir datos sensibles.
- Fase 6: servicio Python (FastAPI) con modelos ISIC, worker que pobla `vector_embeddings` y `entity_classifications`.
- Fase 7: portal del paciente (autenticación por magic link).
- Fase 8: dashboards supermédico, bandeja de revisión, auditoría visual.
- Fase 9: hardening + despliegue.

---

## Estructura

```
cepi/
├── README.md                 ← este archivo
├── docs/
│   └── PAPER.md              ← arquitectura + plan de fases
├── ecosystem.config.cjs      ← PM2 (todoerp-backend, todoerp-frontend, cepi-bot, cepi-frontend)
├── scripts/
│   └── reset-cepi.sh         ← reset DB + base + medical seeds (+--with-fake-data)
├── TodoERP/                  ← repo aparte (ignorado por cepi): ERP genérico + MCP + plan de refactor
├── cepi-bot/                 ← agente conversacional (Express + MCP client)
├── cepi-frontend/            ← UI de chat (Vue 3 + Vite)
├── backend/                  ← legacy CEPI chatbot (no PM2)
└── frontend/                 ← legacy CEPI public site (no PM2)
```

---

## Comandos útiles

```powershell
# Reiniciar un servicio
pm2 restart cepi-bot

# Ver logs en vivo
pm2 logs cepi-bot --lines 50

# Re-seed completo
bash scripts/reset-cepi.sh --with-fake-data

# Tests del backend ERP
cd TodoERP\backend && npx vitest run

# Tests del bot
cd cepi-bot && npx vitest run

# Smoke del bot
$jwt = (Invoke-RestMethod -Uri http://localhost:3001/api/auth/login -Method POST -ContentType 'application/json' -Body '{"email":"admin@erp.com","password":"Admin123!"}').token
Invoke-RestMethod -Uri http://localhost:3002/api/bot/chat -Method POST -ContentType 'application/json' -Headers @{Authorization="Bearer $jwt"} -Body '{"message":"pacientes"}'
```
