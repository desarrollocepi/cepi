#!/usr/bin/env bash
# Alinea la contraseña de bot-telegram@cepi.local en la base con la que tiene el
# vault (ns cepi-prod). Corre EN el servidor de prod.
#
# Por qué: dotrino-env pisa con el vault las variables del ecosystem, así que
# cepi-bot usa la TELEGRAM_BOT_PASSWORD del vault. El corte de bots
# (corte-bots-cuentas-servicio.sh) puso otra en la base y el login daba 401.
# La contraseña nunca se imprime: se hashea dentro del proceso de dotrino-env.
set -euo pipefail

cd /opt/cepi/TodoERP/backend
# El valor de relleno hace falta: con la variable vacía dotrino-env no la pisa.
H=$(TELEGRAM_BOT_PASSWORD=x DOTRINO_ENV_QUIET=1 dotrino-env run --ns cepi-prod -- \
      node -e 'console.log(require("bcryptjs").hashSync(process.env.TELEGRAM_BOT_PASSWORD, 10))' \
      2>/dev/null | grep '^\$2' || true)
[[ ${#H} -eq 60 ]] || { echo "ERROR: no se obtuvo el hash desde el vault"; exit 1; }

sudo -u postgres psql -d cepi -v ON_ERROR_STOP=1 -q \
  -c "UPDATE users SET password_hash = '$H', updated_at = NOW() WHERE email = 'bot-telegram@cepi.local'" \
  2>/dev/null
echo "base actualizada"

cd /opt/cepi/cepi-bot
TELEGRAM_BOT_PASSWORD=x DOTRINO_ENV_QUIET=1 dotrino-env run --ns cepi-prod -- node -e '
fetch("http://localhost:3001/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: process.env.TELEGRAM_BOT_EMAIL, password: process.env.TELEGRAM_BOT_PASSWORD }),
}).then(async r => {
  const j = await r.json().catch(() => ({}));
  const ok = r.status === 200 && !!(j.token || j.data?.token);
  console.log(ok ? "OK: " + process.env.TELEGRAM_BOT_EMAIL + " entra" : "ERROR: login HTTP " + r.status);
  process.exit(ok ? 0 : 1);
})' 2>/dev/null
