# CLAUDE.md — repositorio cepi

Guía para Claude Code y para devs nuevos.

## Lo que vive aquí

```
cepi/
├── docs/PAPER.md         arquitectura + plan de fases (LEER PRIMERO)
├── docs/STATUS.md        progreso al cierre de sesión
├── README.md             quick start operacional
├── ecosystem.config.cjs  PM2 con los 4 servicios JS + 1 Python
├── docker-compose.yml    deploy alternativo
├── scripts/              reset, dev-token, dev-chat, backup
├── TodoERP/              submódulo: ERP genérico + MCP server
├── cepi-bot/             agente conversacional (HTTP + MCP client)
├── cepi-frontend/        UI de chat (Vue 3 + Vite)
├── cepi-isic/            servicio Python de embeddings/clasificación
├── backend/              chatbot legacy (DeepSeek + tree.js) — sin PM2
└── frontend/             site público legacy CEPI — sin PM2
```

`backend/` y `frontend/` quedan como referencia histórica y no se
mantienen activamente. La capa medical vive en `cepi-bot` + `cepi-frontend`.

## Reglas de trabajo

- **Paper-first**: cambios estructurales pasan primero por `docs/PAPER.md`. El plan de fases del paper §15 manda.
- **TodoERP genérico, cepi medical**: `TodoERP/` no debe contener vocabulario clínico. Si una capacidad parece útil para más de un dominio, vive en TodoERP. La opt-in al pipeline médico se hace con `CEPI_MEDICAL=1` en el backend.
- **Confirmation gate**: las escrituras que el agente *infiere* de texto libre o de un comando se confirman con sí/no antes de persistir (PAPER §13.3.1, D-Aux-1). El patrón vive en `cepi-bot/src/server.ts` (pending_action). Los **envíos de formularios de la ficha** (`ficha_grp_*`, incluidas las imágenes §4.7/§8) ya son una acción explícita del usuario: se guardan directo, sin gate.
- **Nunca ocultes un botón: deshabilítalo.** Un control que existe conceptualmente se
  renderiza siempre, con `:disabled` y un `title` que diga por qué no aplica ahora. Nada de
  `v-if` para esconderlo. Si el estado vacío es el habitual, ponlo por escrito en la propia
  barra ("única visita registrada de este paciente"). Un botón gris comunica "esto existe,
  hoy no aplica"; la ausencia no comunica nada y se lee como función rota o no desplegada
  — pasó con la navegación entre visitas del portal, escondida tras `visitas.length > 1`
  cuando el 69% de los episodios son de pacientes con una sola visita. **Única excepción:
  permisos** — lo que el usuario nunca podrá hacer sí se oculta, porque un botón muerto por
  falta de permiso es ruido.
- **PII**: campos con `pii: true` en `entity_definitions.config.fields` se redactan al cruzar dos fronteras: `cepi-bot → LLM` (PAPER §13.3.1) y `TodoERP → role sin pii:read:<slug>` (R4 de REFACTOR_PLAN). Ambas implementadas.
- **Tests verde antes de commit**: `npx vitest run` en `TodoERP/backend` y `cepi-bot`. Total actual ~202 tests.
- **Git**: los remotes viven en la cuenta `desarrollocepi` (`desarrollocepi/cepi` público, `desarrollocepi/TodoERP` privado). El subm `TodoERP/` tiene su propio remote; el cepi raíz lo apunta por SHA. Hay una rama feature por concern (`feat/generic-fase1` en TodoERP, `feat/medical-assistant` en cepi).

## Cuando agregás...

### un comando del bot
1. Regex en `cepi-bot/src/server.ts` antes del fallthrough al LLM.
2. Si es escritura: `pending_action`. Si lectura: tool call directo.
3. Línea en `/help` (`cepi-bot/src/llm.ts`).
4. Botón en `cepi-frontend/src/components/Chat.vue` si es de uso frecuente.
5. Test de regex en `cepi-bot/tests/server_commands.test.ts`.

### una tool MCP
1. Entrada en `TodoERP/mcp/src/tools.ts`.
2. Restart MCP. El bot lo detecta vía `listTools()`.
3. Si la tool exige permisos nuevos, agregarlos a `database/seeds/*.sql`.

### una capacidad del ERP (genérica)
1. Migración SQL en `TodoERP/database/migrations/`.
2. Permisos en `TodoERP/database/seeds/`.
3. Router/service nuevo siguiendo la convención R9 (>300 LOC ⇒ split).
4. Test en `TodoERP/backend/tests/`.
5. Documentar en `TodoERP/CLAUDE.md` si introduce un patrón.

### una entidad clínica nueva
1. Definir el `entity_definition` en `medical-seed/001`.
2. Form + nav en `medical-seed/005`.
3. Permisos en `002` si aplica.
4. Si tiene relaciones, no olvides los inversos.
5. Idempotencia: usar `ON CONFLICT (id) DO UPDATE`.

### un hook de ciclo de vida
1. Handler en `TodoERP/backend/src/hooks/medical.ts` (o `domain.ts`).
2. Registrar vía `registerHook(...)` en una factory; llamarla en `app.ts` con la guarda env adecuada.
3. Declarar `config.hooks.on_create|on_update|on_delete` en el `entity_definition` correspondiente.
4. Test que dispara el evento y verifica el efecto.

## Atajos útiles

```powershell
# Levantar todo
pm2 start ecosystem.config.cjs

# Reset DB con datos médicos + ficticios
bash scripts/reset-cepi.sh --with-fake-data

# Smoke conversacional
bash scripts/dev-chat.sh --new "/help"

# Backup
bash scripts/backup-db.sh
```

## Bots de testing (browser-bot multi-perfil)

Para probar la app desde 6 roles a la vez (una ventana Chrome auto-logueada por
rol: `primario derma1 derma2 residente super admin`):

```bash
./lanzar-bots.sh          # arranca las 6 ventanas + API en :8899 (idempotente)
```

- **El usuario** corre `./lanzar-bots.sh` en su sesión gráfica — el agente NO
  puede lanzar Chrome desde el sandbox, pero SÍ maneja las ventanas por
  `curl http://localhost:8899` (o `scripts/browser-bot/drive.sh …`).
- Idempotente: si el bot ya corre, no relanza. Reiniciar:
  `pkill -f browser-bot/bot.cjs && ./lanzar-bots.sh`.
- Datos de prueba multi-org: los usuarios demo viven en **ambas** orgs
  (`cepi` + `cepi-testing`) — así la derivación funciona sin importar en qué org
  caiga el caso (el revisor debe pertenecer a la org del caso) y el switch del
  topbar sigue siendo probable. El auto-registro asigna las orgs por defecto vía
  `assignDefaultOrgs` (`REGISTER_DEFAULT_ORG_SLUGS`, default `cepi,cepi-testing`).
  Ver `medical-seed/007_telemedicine.sql`.
