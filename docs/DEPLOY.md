# Deploy a producción

Prod es el EC2 `3.23.236.49` (`casos.cepi.ec`, `telemedicina.cepi.ec`). Se despliega
**solo desde `master`**, con GitHub Actions: `.github/workflows/deploy-prod.yml`.

| Evento | Qué corre |
|---|---|
| push a `master` | tests → build → **deploy** |
| push a una rama `ci/**` | tests → build → **dry-run** contra prod |
| *Run workflow* manual | dry-run por defecto; deploy solo sobre `master` y desmarcando `dry_run` |

Dos deploys nunca corren a la vez (`concurrency: deploy-prod`, sin cancelar el que está en curso).

## TodoERP es un repo aparte

TodoERP (`desarrollocepi/TodoERP`, privado) vive dentro de la carpeta de cepi pero cepi no
lo registra. El CI lo clona con una deploy key de solo lectura (`scripts/deploy/ci-todoerp.sh`)
y **despliega la punta de su rama `main`** en el momento del run. El job de deploy usa el
mismo commit que pasó los tests, no vuelve a leer la rama.

Consecuencias:

- Un push a TodoERP no dispara nada. Para desplegarlo: push a `master` de cepi o *Run workflow*.
- Lo que esté en `main` de TodoERP es lo que va a prod. Una rama feature de TodoERP no se
  despliega hasta que se lleva a `main`.
- La tabla `deploy_sql_aplicado` guarda en `commit_sha` el commit de TodoERP del deploy.

## Qué hace cada job

**tests** — Postgres 18 con pgvector como servicio. `scripts/deploy/ci-test-db.sh` arma la
base desde cero: esquema, seeds, arranque del backend para que cree las tablas espejo, seeds
otra vez y datos sintéticos. Luego `vitest` en `TodoERP/backend` y en `cepi-bot`.

**deploy** — compila `cepi-frontend` y `TodoERP/mcp` en el runner (en el t3.micro `vite build`
se queda sin memoria), sube el release a `/opt/cepi-deploy/incoming` y ejecuta
`scripts/deploy/remote-deploy.sh` en el servidor:

1. **SQL pendiente**, ensayado en `BEGIN … ROLLBACK`. Si falla, se detiene sin tocar nada.
2. **Foto** del código vivo en `/opt/cepi-deploy/previous`.
3. **Código nuevo**, y `npm ci` solo en los paquetes cuyo `package-lock.json` cambió.
4. **Respaldo** `pg_dump` en `/opt/cepi/backups/cepi_deploy_*.dump` (se conservan 10) y el
   SQL pendiente en **una sola transacción**.
5. **Restart** de `todoerp-backend` y `cepi-bot` y chequeo de `/health` en los dos, que tienen
   que seguir en 200 diez segundos después.
6. **Re-aplica** el SQL de este deploy: algunos seeds crean índices sobre tablas que el backend
   crea recién al arrancar (014, 008, 009).

Si falla 3 o 4, se restaura la foto. Si falla 5, se restaura la foto y se reinicia otra vez.
**La base no se revierte sola**: si el SQL ya se aplicó y los servicios no levantan, el log
indica el respaldo para restaurarlo a mano.

## Qué administra el deploy y qué no

Administra, con `--delete`: `TodoERP/backend/src`, `TodoERP/database`, `TodoERP/mcp/dist`,
`cepi-bot/src`, `cepi-frontend/dist`, más los `package.json`, `package-lock.json` y
`tsconfig.json` de cada paquete.

No toca: `/opt/cepi/uploads`, `/opt/cepi/ota`, `.env`, `.secrets*`, `backups`, `node_modules`
(salvo por `npm ci`), la config de nginx, los procesos de PM2 ni el vault (`dotrino-env
--ns cepi-prod`). Un cambio en cualquiera de esas cosas sigue siendo manual.

## SQL: qué se considera pendiente

La tabla `deploy_sql_aplicado` guarda `archivo` + `sha256` de lo aplicado.

- **Migraciones** (`TodoERP/database/migrations/*.sql`, por nombre): van si son nuevas o cambió
  su contenido.
- **Seeds médicos** (orden de `medical-seed/apply.sh`, que es la única fuente de ese orden): el
  primero nuevo o cambiado **arrastra a todos los que le siguen**. Los seeds posteriores corrigen
  lo que los anteriores pisan; por ejemplo, 015 devuelve `medico_id` a opcional después de 001.

Todo el SQL tiene que ser **idempotente** y poder correr **dentro de una transacción**: nada de
`CREATE INDEX CONCURRENTLY` ni `ALTER TYPE … ADD VALUE`.

Para forzar que un archivo se vuelva a aplicar: borrar su fila de `deploy_sql_aplicado`.

Un seed nuevo **tiene que agregarse a `apply.sh`**; si no, el deploy no lo ve.

## Logs

El repo es público y los logs de Actions también, así que en Actions solo aparecen pasos,
nombres de archivo y códigos HTTP. La salida de psql, npm y PM2 queda en el servidor, en
`/opt/cepi-deploy/logs/` (se conservan 50).

## Configuración en GitHub

En `desarrollocepi/cepi` → Settings → Secrets and variables → Actions:

| Nombre | Tipo | Qué es |
|---|---|---|
| `PROD_SSH_KEY` | secret | llave privada con la que Actions entra al EC2 |
| `TODOERP_DEPLOY_KEY` | secret | llave privada de una deploy key **de solo lectura** en `desarrollocepi/TodoERP`; con ella el CI clona TodoERP |
| `PROD_HOST` | variable | `3.23.236.49` |
| `PROD_USER` | variable | `ubuntu` |
| `PROD_SSH_KNOWN_HOSTS` | variable | clave de host del EC2, para no aceptar un host cualquiera |
| `VITE_GOOGLE_CLIENT_ID` | variable | client id web de Google (`cepi-500221`) |

La llave pública de `PROD_SSH_KEY` está en `~/.ssh/authorized_keys` de `ubuntu` con la opción
`restrict` (sin reenvío de puertos, agente ni pty).

## Una sola vez por servidor

La tabla de control se crea con `baseline`, que registra los SQL presentes como ya aplicados
**sin ejecutarlos**. Solo tiene sentido en una base que ya tiene aplicado ese SQL:

```bash
bash /opt/cepi-deploy/incoming/scripts/deploy/remote-deploy.sh baseline
```

## Probar el pipeline sin desplegar

Push a una rama `ci/<algo>`: corre todo contra prod en modo dry-run y muestra el SQL pendiente
y cuántos archivos cambiarían en cada directorio.

El script también corre fuera del servidor para probarlo, con `DEPLOY_LIVE`, `DEPLOY_BASE`,
`DEPLOY_PSQL`, `DEPLOY_PGDUMP`, `DEPLOY_PM2` y `DEPLOY_SALUD_INTENTOS`.

## Restaurar a mano

```bash
# código: la foto del deploy anterior
rsync -a --delete /opt/cepi-deploy/previous/<dir>/ /opt/cepi/<dir>/
pm2 restart todoerp-backend cepi-bot

# base: el respaldo que indica el log del deploy
sudo -u postgres pg_restore --clean --if-exists -d cepi /opt/cepi/backups/cepi_deploy_<...>.dump
```
