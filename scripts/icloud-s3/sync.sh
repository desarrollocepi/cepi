#!/usr/bin/env bash
# Espejo one-way iCloud Drive -> S3.
#
# NUNCA borra en iCloud y NUNCA borra en S3: usa `rclone copy`, no `sync`.
# Un archivo que desaparece de la carpeta compartida se queda en el bucket.
#
# Config: /opt/cepi/.secrets.d/icloud-s3.env (600). Ver README.md.
set -euo pipefail

CONF="${ICLOUD_SYNC_CONF:-/opt/cepi/.secrets.d/icloud-s3.env}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

RCLONE_CONF="${RCLONE_CONF:-/opt/cepi/.secrets.d/rclone.conf}"
REMOTE_ICLOUD="${REMOTE_ICLOUD:-icloud}"
ICLOUD_PATH="${ICLOUD_PATH:?falta ICLOUD_PATH (ruta de la carpeta dentro de iCloud Drive)}"
REMOTE_S3="${REMOTE_S3:-s3cepi}"
S3_BUCKET="${S3_BUCKET:?falta S3_BUCKET}"
S3_PREFIX="${S3_PREFIX:-inbox}"
STATUS_FILE="${STATUS_FILE:-/var/lib/cepi/icloud-sync.status.json}"
LOCK_FILE="${LOCK_FILE:-/var/lock/cepi-icloud-sync.lock}"

# Un solo sync a la vez. Si el anterior sigue corriendo, este sale sin ruido.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "sync anterior todavía corriendo; salgo" >&2
  exit 0
fi

ORIGEN="${REMOTE_ICLOUD}:${ICLOUD_PATH}"
DESTINO="${REMOTE_S3}:${S3_BUCKET}/${S3_PREFIX}"
INICIO=$(date -u +%FT%TZ)

# t3.micro: 908 MB de RAM. Los flags están apretados a propósito —
# subir los transfers/chunks mata la instancia y con ella los backends.
RCLONE_ARGS=(
  --config "$RCLONE_CONF"
  --transfers 2
  --checkers 4
  --buffer-size 8M
  --s3-chunk-size 8M
  --s3-upload-concurrency 2
  --retries 3
  --low-level-retries 10
  --stats 5m
  --stats-log-level NOTICE
  --log-level INFO
)

alerta() {
  local msg="$1"
  echo "$msg" >&2
  [ -n "${ICLOUD_SYNC_ALERT_CMD:-}" ] && ICLOUD_SYNC_MSG="$msg" bash -c "$ICLOUD_SYNC_ALERT_CMD" || true
}

escribir_estado() {
  local code="$1" detalle="$2"
  mkdir -p "$(dirname "$STATUS_FILE")"
  cat > "$STATUS_FILE" <<JSON
{"inicio":"$INICIO","fin":"$(date -u +%FT%TZ)","exit_code":$code,"detalle":"$detalle","origen":"$ORIGEN","destino":"$DESTINO"}
JSON
}

echo "== iCloud -> S3 :: $ORIGEN -> $DESTINO"

set +e
rclone copy "$ORIGEN" "$DESTINO" "${RCLONE_ARGS[@]}"
CODE=$?
set -e

if [ $CODE -ne 0 ]; then
  # El caso frecuente: el trust token de 2FA caducó (~30 días) y iCloud
  # rechaza la sesión. Se arregla re-corriendo `rclone config reconnect`.
  escribir_estado "$CODE" "rclone copy falló"
  alerta "cepi: el espejo iCloud->S3 falló (exit $CODE). Si es 401/403, el trust token de 2FA caducó: hay que reconectar el remote '$REMOTE_ICLOUD'."
  exit $CODE
fi

escribir_estado 0 "ok"
echo "== ok"
