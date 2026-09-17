#!/bin/bash
# Reset the cepi medical project database to a known state.
#
# Layers the medical seeds on top of a clean TodoERP base. Composes (does not
# duplicate) the upstream TodoERP reset.
#
# Order:
#   1. TodoERP/backend/scripts/reset-db.sh     (schema + base seed + Phase 1
#                                               migrations + permission seeds)
#   2. TodoERP/database/medical-seed/apply.sh  (entity_definitions + clinical
#                                               roles/permissions + ISIC
#                                               models + form_configs +
#                                               navs_configs)
#   3. (optional) seeder/run.sh                synthetic ~50 patients, ~150
#                                               episodes, ~120 images,
#                                               classifications, reminders.
#
# Usage:
#   bash scripts/reset-cepi.sh                 # base + medical (no fake data)
#   bash scripts/reset-cepi.sh --with-fake-data
#   bash scripts/reset-cepi.sh --with-invoicing-test-data --with-fake-data
set -e

WITH_FAKE=0
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --with-fake-data) WITH_FAKE=1 ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TODOERP="$ROOT/TodoERP"

echo "[reset-cepi] step 1: TodoERP base reset"
bash "$TODOERP/backend/scripts/reset-db.sh" "${PASSTHROUGH[@]}"

echo "[reset-cepi] step 2: medical seeds"
bash "$TODOERP/database/medical-seed/apply.sh"

if [ "$WITH_FAKE" = "1" ]; then
  # The synthetic seeder writes into per-type shadow tables (entity_classifications,
  # entity_icd10_code, ...) which the backend creates on startup via
  # reconcileTablesOnStartup() — they do NOT exist right after the SQL seeds.
  # Restart the backend so it provisions them before the seeder runs.
  if command -v pm2 >/dev/null 2>&1 && pm2 describe todoerp-backend >/dev/null 2>&1; then
    echo "[reset-cepi] restarting backend to provision shadow tables"
    pm2 restart todoerp-backend >/dev/null 2>&1
    sleep 7
  else
    echo "[reset-cepi] WARNING: pm2 todoerp-backend not found — ensure the backend"
    echo "[reset-cepi]          restarts to create shadow tables before seeding."
  fi
  # 014 (per-org pathology index), 017 (sandbox org patients) and 018 (per-org split)
  # need entity_* tables, which only exist now that the backend has provisioned them
  # (step 2 skipped those parts). 018 runs after the synthetic dataset so it splits it.
  echo "[reset-cepi] re-applying 014 + 017 on the provisioned tables"
  for f in 014_patologia.sql 017_org_pruebas_sandbox.sql; do
    PGPASSWORD=cerebro psql -h localhost -U postgres -d cepi -v ON_ERROR_STOP=1 \
      -f "$TODOERP/database/medical-seed/$f" > /dev/null
  done
  echo "[reset-cepi] step 3: synthetic clinical dataset"
  bash "$TODOERP/database/medical-seed/seeder/run.sh"
  echo "[reset-cepi] step 4: split records per organization (018)"
  PGPASSWORD=cerebro psql -h localhost -U postgres -d cepi -v ON_ERROR_STOP=1 \
    -f "$TODOERP/database/medical-seed/018_org_drpro.sql" > /dev/null
fi

echo "[reset-cepi] done."
