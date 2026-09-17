#!/usr/bin/env bash
# Base de tests del CI, desde cero, en el Postgres de servicio del job.
#
# Es el mismo camino que una instalación nueva, y el orden importa porque las
# tablas espejo (`entity_patient`, `entity_episode`, …) no las crea ningún SQL:
# las crea el BACKEND al arrancar. Por eso:
#   1. esquema + seed base + migraciones        (TodoERP/backend/scripts/reset-db.sh)
#   2. seeds médicos                             (se saltan lo que depende de las tablas espejo)
#   3. arrancar el backend hasta que reconcilia  → crea las tablas espejo
#   4. seeds médicos otra vez                    → índices y columnas sobre esas tablas
#   5. datos sintéticos                          (medical-seed/seeder)
#
# Espera DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME en el entorno. apply.sh y el
# seeder tienen fijo postgres:cerebro@localhost/cepi, así que el servicio del job
# usa exactamente eso.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MED=$ROOT/TodoERP/database/medical-seed
export PGPASSWORD=$DB_PASSWORD

echo "== 1. esquema, seed base y migraciones"
bash "$ROOT/TodoERP/backend/scripts/reset-db.sh"

echo "== 2. seeds médicos"
bash "$MED/apply.sh"

echo "== 3. backend hasta que crea las tablas espejo"
LOG_BACKEND=$(mktemp)
(
  cd "$ROOT/TodoERP/backend"
  PORT=3101 STAGE=DEVELOP CEPI_MEDICAL=1 JWT_SECRET=ci \
    exec node --no-warnings=ExperimentalWarning --loader ts-node/esm src/app.ts
) > "$LOG_BACKEND" 2>&1 &
PID=$!
listo=0
for _ in $(seq 1 120); do
  if grep -q '\[ColumnSync\] Startup reconciliation complete' "$LOG_BACKEND"; then listo=1; break; fi
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
if [[ $listo != 1 ]]; then
  echo "El backend no terminó de reconciliar. Últimas líneas:"
  tail -n 40 "$LOG_BACKEND"
  exit 1
fi
grep -E '\[(EntityTable|ColumnSync)\] Startup reconciliation complete' "$LOG_BACKEND"

echo "== 4. seeds médicos sobre las tablas espejo"
bash "$MED/apply.sh"

echo "== 5. datos sintéticos"
bash "$MED/seeder/run.sh"
