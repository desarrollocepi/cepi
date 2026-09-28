#!/usr/bin/env bash
# Relanza un servicio de prod (cepi-bot | todoerp-backend) con su lanzador real:
# `dotrino-env run --ns cepi-prod` (los secretos salen del vault), el cwd de
# siempre y el env del ecosystem. Uso: levantar-servicio-prod.sh [servicio]
#
# Hace falta porque el ecosystem del repo arranca con `script: 'node'`, pero en
# prod los procesos corren envueltos en dotrino-env. Un `pm2 restart ecosystem…`
# mezcla el script viejo con los args del archivo y el proceso no arranca
# («comando desconocido: --no-warnings…»). Pasó el 2026-09-28 en el corte.
set -euo pipefail

SERVICIO=${1:-cepi-bot}
case "$SERVICIO" in
  cepi-bot)        DIR=/opt/cepi/cepi-bot;        ENTRADA=src/server.ts; PUERTO=3002 ;;
  todoerp-backend) DIR=/opt/cepi/TodoERP/backend; ENTRADA=src/app.ts;    PUERTO=3001 ;;
  *) echo "servicio desconocido: $SERVICIO"; exit 1 ;;
esac

# pm2 solo trata un archivo como ecosystem si el nombre lleva `.config.` o
# `ecosystem`; con otro nombre lo corre como un programa más (pasó: `eco-bot`).
CONF=/tmp/$SERVICIO.config.cjs
cat > "$CONF" <<JS
const eco = require('/opt/cepi/ecosystem.config.cjs');
const app = eco.apps.find(a => a.name === '$SERVICIO');
module.exports = { apps: [{
  ...app,
  script: '/usr/bin/dotrino-env',
  args: ['run', '--ns', 'cepi-prod', '--', 'node', '--no-warnings=ExperimentalWarning',
         '--loader', 'ts-node/esm', '$ENTRADA'],
  interpreter: 'node',
  cwd: '$DIR',
}] };
JS

pm2 delete "$SERVICIO" >/dev/null 2>&1 || true
pm2 delete eco-bot >/dev/null 2>&1 || true
pm2 start "$CONF"
pm2 id "$SERVICIO" | grep -q '[0-9]' || { echo "ERROR: pm2 no creó $SERVICIO"; exit 1; }

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 3 "http://localhost:$PUERTO/health"; then
    echo "$SERVICIO arriba tras ~$((i * 3)) s"
    pm2 save >/dev/null
    exit 0
  fi
  sleep 3
done
echo "ERROR: $SERVICIO no respondió en 90 s"
pm2 logs "$SERVICIO" --nostream --lines 20 --err
exit 1
