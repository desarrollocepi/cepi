#!/usr/bin/env bash
# Deploy de producción, lado servidor. Lo invoca .github/workflows/deploy-prod.yml
# después de subir el release a /opt/cepi-deploy/incoming. Ver docs/DEPLOY.md.
#
#   remote-deploy.sh deploy  <sha>   aplica el release que está en incoming
#   remote-deploy.sh dry-run <sha>   ensaya lo mismo sin tocar nada vivo
#   remote-deploy.sh baseline        marca los SQL actuales como ya aplicados (una sola vez)
#
# Orden de deploy, y qué pasa si falla cada paso:
#   1. SQL pendiente: ensayo en BEGIN … ROLLBACK        → falla: nada cambió
#   2. foto del código vivo en /opt/cepi-deploy/previous
#   3. código nuevo + npm ci si cambió el lock           → falla: se restaura la foto
#   4. respaldo pg_dump + SQL en UNA transacción         → falla: se restaura la foto
#   5. restart de todoerp-backend y cepi-bot + salud      → falla: foto + restart
#   6. re-aplica el SQL de este deploy (índices sobre tablas que crea el backend al arrancar)
#
# La base NO se revierte sola: si el paso 5 falla después del 4, el respaldo queda
# en /opt/cepi/backups y se restaura a mano.
#
# El repo es público y los logs de Actions también: acá no se imprimen logs de PM2
# ni salida de psql (traen datos de pacientes). Van a /opt/cepi-deploy/logs.
set -euo pipefail
export LC_ALL=C.UTF-8

# Rutas y psql configurables solo para probar el script fuera del servidor.
LIVE=${DEPLOY_LIVE:-/opt/cepi}
BASE=${DEPLOY_BASE:-/opt/cepi-deploy}
STAGE=$BASE/incoming
PREV=$BASE/previous
LOGS=$BASE/logs
BACKUPS=$LIVE/backups
TRACK=deploy_sql_aplicado
RESPALDOS_A_CONSERVAR=10

# Lo único que el deploy administra. El resto de /opt/cepi —uploads, ota, .env,
# .secrets, backups, node_modules— no se toca nunca.
DIRS=(TodoERP/backend/src TodoERP/database TodoERP/mcp/dist cepi-bot/src cepi-frontend/dist)
FILES=(
  TodoERP/backend/package.json TodoERP/backend/package-lock.json TodoERP/backend/tsconfig.json
  TodoERP/mcp/package.json TodoERP/mcp/package-lock.json
  cepi-bot/package.json cepi-bot/package-lock.json cepi-bot/tsconfig.json
)
NPM_PKGS=(TodoERP/backend TodoERP/mcp cepi-bot)
SERVICIOS=(todoerp-backend cepi-bot)

MODO=${1:?uso: remote-deploy.sh deploy|dry-run <sha> | baseline}
SHA=${2:-manual}
mkdir -p "$LOGS"
LOG=$LOGS/$(date -u +%Y%m%dT%H%M%SZ)_${MODO}_${SHA:0:12}.log

paso() { printf '\n== %s\n' "$*"; }
pg_dump_() { if [[ -n ${DEPLOY_PGDUMP:-} ]]; then $DEPLOY_PGDUMP; else sudo -u postgres pg_dump -Fc cepi; fi; }
pm2_() { if [[ -n ${DEPLOY_PM2:-} ]]; then $DEPLOY_PM2 "$@"; else pm2 "$@"; fi; }
psql_() {
  if [[ -n ${DEPLOY_PSQL:-} ]]; then $DEPLOY_PSQL -X -q -v ON_ERROR_STOP=1 "$@"
  else sudo -u postgres psql -d cepi -X -q -v ON_ERROR_STOP=1 "$@"; fi
}

exec 9> "$BASE/deploy.lock"
flock -n 9 || { echo "Hay otro deploy en curso"; exit 1; }

# ── SQL ──────────────────────────────────────────────────────────────────────
# Orden: migraciones genéricas por nombre, luego los seeds médicos en el orden de
# apply.sh (la única fuente de verdad de ese orden).
listar_sql() {
  local raiz=$1
  (cd "$raiz" && ls TodoERP/database/migrations/*.sql | sort)
  grep -E '^\s*for f in' "$raiz/TodoERP/database/medical-seed/apply.sh" \
    | grep -oE '[0-9]{3}_[A-Za-z0-9_]+\.sql' \
    | sed 's#^#TodoERP/database/medical-seed/#'
}

# Una migración va si es nueva o cambió. Un seed médico que es nuevo o cambió
# arrastra a TODOS los seeds que le siguen: los posteriores corrigen lo que los
# anteriores pisan (p. ej. 015 devuelve `medico_id` a opcional después de 001).
sql_pendiente() {
  local raiz=$1 aplicados cascada=0 f sha
  aplicados=$(psql_ -At -c "SELECT archivo || ' ' || sha256 FROM $TRACK")
  while read -r f; do
    sha=$(sha256sum "$raiz/$f" | cut -d' ' -f1)
    if [[ $f == TodoERP/database/medical-seed/* && $cascada == 1 ]]; then echo "$f"; continue; fi
    if ! grep -qxF "$f $sha" <<< "$aplicados"; then
      echo "$f"
      [[ $f == TodoERP/database/medical-seed/* ]] && cascada=1
    fi
  done < <(listar_sql "$raiz")
  return 0
}

# Arma la transacción: cada archivo seguido del registro de su hash.
# $3 = COMMIT | ROLLBACK;  $4 = 1 para registrar en la tabla de control.
guion_sql() {
  local raiz=$1 lista=$2 fin=$3 registrar=$4 f sha
  echo 'BEGIN;'
  while read -r f; do
    [[ -z $f ]] && continue
    sha=$(sha256sum "$raiz/$f" | cut -d' ' -f1)
    printf '\\echo -- %s\n' "$f"
    cat "$raiz/$f"
    printf '\n;\n'
    if [[ $registrar == 1 ]]; then
      printf "INSERT INTO %s (archivo, sha256, commit_sha) VALUES ('%s', '%s', '%s')\n" "$TRACK" "$f" "$sha" "$SHA"
      printf "  ON CONFLICT (archivo) DO UPDATE SET sha256 = EXCLUDED.sha256, commit_sha = EXCLUDED.commit_sha, aplicado_at = now();\n"
    fi
  done <<< "$lista"
  echo "$fin;"
}

tabla_control_existe() {
  [[ $(psql_ -At -c "SELECT to_regclass('public.$TRACK') IS NOT NULL") == t ]]
}

# ── código ───────────────────────────────────────────────────────────────────
copiar_arbol() {   # origen destino [opciones rsync extra]
  local de=$1 a=$2; shift 2
  local d f
  for d in "${DIRS[@]}"; do
    mkdir -p "$a/$d"
    rsync -a --delete --delay-updates --delete-after "$@" "$de/$d/" "$a/$d/"
  done
  for f in "${FILES[@]}"; do
    [[ -e $de/$f ]] || continue
    mkdir -p "$(dirname "$a/$f")"
    cp -p "$de/$f" "$a/$f"
  done
}

npm_que_cambia() {   # imprime los paquetes cuyo lock difiere de lo vivo o sin node_modules
  local p
  for p in "${NPM_PKGS[@]}"; do
    if [[ ! -d $LIVE/$p/node_modules ]] || ! cmp -s "$STAGE/$p/package-lock.json" "$LIVE/$p/package-lock.json"; then
      echo "$p"
    fi
  done
}

npm_ci() {
  local p
  for p in "$@"; do
    echo "npm ci en $p"
    (cd "$LIVE/$p" && npm ci --no-audit --no-fund >> "$LOG" 2>&1) || return 1
  done
}

salud() {   # 200 en los dos servicios, y siguen en pie 10 s después
  local i a b
  for i in $(seq 1 "${DEPLOY_SALUD_INTENTOS:-60}"); do
    a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health || true)
    b=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/health || true)
    if [[ $a == 200 && $b == 200 ]]; then
      sleep 10
      a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health || true)
      b=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/health || true)
      echo "todoerp-backend $a · cepi-bot $b"
      [[ $a == 200 && $b == 200 ]] && return 0
    fi
    sleep 2
  done
  echo "todoerp-backend $a · cepi-bot $b"
  return 1
}

reiniciar() { pm2_ restart "${SERVICIOS[@]}" >> "$LOG" 2>&1; }

NPM_REINSTALADOS=()
revertir_codigo() {
  paso "REVIRTIENDO el código a la foto previa"
  copiar_arbol "$PREV" "$LIVE"
  if (( ${#NPM_REINSTALADOS[@]} )); then npm_ci "${NPM_REINSTALADOS[@]}"; fi
}

# ── modos ────────────────────────────────────────────────────────────────────
case $MODO in

baseline)
  if tabla_control_existe; then echo "La tabla $TRACK ya existe; baseline no hace falta"; exit 1; fi
  paso "baseline: los SQL presentes en $LIVE se registran como aplicados, sin ejecutarlos"
  {
    echo "CREATE TABLE $TRACK (archivo TEXT PRIMARY KEY, sha256 TEXT NOT NULL,"
    echo "  commit_sha TEXT, aplicado_at TIMESTAMPTZ NOT NULL DEFAULT now());"
    echo "COMMENT ON TABLE $TRACK IS 'SQL aplicado por el deploy (scripts/deploy/remote-deploy.sh). Borrar una fila fuerza a re-aplicar ese archivo.';"
    while read -r f; do
      printf "INSERT INTO %s (archivo, sha256, commit_sha) VALUES ('%s', '%s', 'baseline');\n" \
        "$TRACK" "$f" "$(sha256sum "$LIVE/$f" | cut -d' ' -f1)"
    done < <(listar_sql "$LIVE")
  } | psql_ -1 >> "$LOG" 2>&1
  psql_ -At -c "SELECT count(*) || ' archivos registrados' FROM $TRACK"
  ;;

dry-run|deploy)
  [[ -d $STAGE/TodoERP/backend/src && -f $STAGE/cepi-frontend/dist/index.html ]] \
    || { echo "El release en $STAGE está incompleto"; exit 1; }
  tabla_control_existe || { echo "Falta la tabla $TRACK: correr 'remote-deploy.sh baseline' una vez"; exit 1; }
  echo "release ${SHA:0:12} · modo $MODO · log en $LOG"

  paso "1. SQL pendiente"
  PENDIENTE=$(sql_pendiente "$STAGE")
  if [[ -n $PENDIENTE ]]; then
    echo "$PENDIENTE" | sed 's/^/  /'
    guion_sql "$STAGE" "$PENDIENTE" ROLLBACK 0 | psql_ >> "$LOG" 2>&1 \
      || { echo "El ensayo del SQL falló (ver $LOG). No se tocó nada."; exit 1; }
    echo "ensayo OK (ROLLBACK)"
  else
    echo "  ninguno"
  fi

  REINSTALAR=$(npm_que_cambia)

  if [[ $MODO == dry-run ]]; then
    paso "2. cambios de código que aplicaría"
    for d in "${DIRS[@]}"; do
      n=$(rsync -a --delete --dry-run --itemize-changes "$STAGE/$d/" "$LIVE/$d/" | grep -c . || true)
      printf '  %-24s %s cambios\n' "$d" "$n"
    done
    echo "  npm ci en: $(echo ${REINSTALAR:-ninguno})"
    paso "dry-run terminado: no se tocó nada vivo"
    exit 0
  fi

  paso "2. foto del código vivo"
  rm -rf "$PREV"; mkdir -p "$PREV"
  copiar_arbol "$LIVE" "$PREV"
  echo "en $PREV"

  paso "3. código nuevo"
  copiar_arbol "$STAGE" "$LIVE"
  if [[ -n $REINSTALAR ]]; then
    mapfile -t NPM_REINSTALADOS <<< "$REINSTALAR"
    if ! npm_ci "${NPM_REINSTALADOS[@]}"; then
      echo "npm ci falló (ver $LOG)"; revertir_codigo; exit 1
    fi
  else
    echo "dependencias sin cambios"
  fi

  if [[ -n $PENDIENTE ]]; then
    paso "4. respaldo y SQL"
    DUMP=$BACKUPS/cepi_deploy_$(date -u +%Y%m%dT%H%M%SZ)_${SHA:0:12}.dump
    pg_dump_ > "$DUMP" && test -s "$DUMP" \
      || { echo "pg_dump falló"; revertir_codigo; exit 1; }
    echo "respaldo: $DUMP"
    ls -1t "$BACKUPS"/cepi_deploy_*.dump 2>/dev/null | tail -n +$((RESPALDOS_A_CONSERVAR + 1)) | xargs -r rm -f
    if ! guion_sql "$STAGE" "$PENDIENTE" COMMIT 1 | psql_ >> "$LOG" 2>&1; then
      echo "El SQL falló y se revirtió la transacción (ver $LOG)"; revertir_codigo; exit 1
    fi
    echo "SQL aplicado"
  else
    paso "4. sin SQL pendiente"
  fi

  paso "5. reinicio y salud"
  reiniciar
  if ! salud; then
    echo "Los servicios no quedaron sanos"
    revertir_codigo
    reiniciar
    salud || echo "TAMPOCO quedaron sanos con el código anterior: revisar a mano"
    [[ -n $PENDIENTE ]] && echo "La base quedó con el SQL nuevo. Respaldo previo: $DUMP"
    exit 1
  fi

  if [[ -n $PENDIENTE ]]; then
    paso "6. re-aplicar el SQL de este deploy sobre las tablas que creó el backend"
    guion_sql "$STAGE" "$PENDIENTE" COMMIT 0 | psql_ >> "$LOG" 2>&1 \
      || { echo "La re-aplicación falló (ver $LOG). El código nuevo está vivo y sano."; exit 1; }
    echo "OK"
  fi

  ls -1t "$LOGS"/*.log | tail -n +51 | xargs -r rm -f
  paso "deploy ${SHA:0:12} terminado"
  ;;

*) echo "modo desconocido: $MODO"; exit 2 ;;
esac
