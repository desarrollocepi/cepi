#!/usr/bin/env bash
# Levanta cepi-bot en prod con su lanzador real: `dotrino-env run --ns cepi-prod`
# (los secretos salen del vault), el cwd de siempre y el env del ecosystem.
#
# Hace falta porque el ecosystem del repo arranca con `script: 'node'`, pero en
# prod el proceso corre envuelto en dotrino-env. Un `pm2 restart ecosystem…`
# mezcla el script viejo con los args del archivo y el bot no arranca
# («comando desconocido: --no-warnings…»). Pasó el 2026-09-28 en el corte.
set -euo pipefail

cat > /tmp/eco-bot.cjs <<'EOF'
const eco = require('/opt/cepi/ecosystem.config.cjs');
const bot = eco.apps.find(a => a.name === 'cepi-bot');
module.exports = { apps: [{
  ...bot,
  script: '/usr/bin/dotrino-env',
  args: ['run', '--ns', 'cepi-prod', '--', 'node', '--no-warnings=ExperimentalWarning',
         '--loader', 'ts-node/esm', 'src/server.ts'],
  interpreter: 'node',
  cwd: '/opt/cepi/cepi-bot',
}] };
EOF

pm2 delete cepi-bot >/dev/null 2>&1 || true
pm2 start /tmp/eco-bot.cjs >/dev/null

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 3 http://localhost:3002/health; then
    echo "cepi-bot arriba tras ~$((i * 3)) s"
    pm2 save >/dev/null
    exit 0
  fi
  sleep 3
done
echo "ERROR: cepi-bot no respondió en 90 s"
pm2 logs cepi-bot --nostream --lines 20 --err
exit 1
