#!/usr/bin/env bash
# Corte de los bots a sus cuentas de servicio (PAPER §27.6).
#
# Hoy WhatsApp y Telegram se autentican en prod con `admin@erp.com`, la cuenta de
# los seeds, cuya contraseña está escrita en el repo — y que además es superadmin.
# Este script los pasa a `bot-whatsapp@cepi.local` y `bot-telegram@cepi.local`,
# que el seed 020 dejó con rol `bot_canal`: solo resuelven, crean y vinculan
# identidades de chat.
#
# Reglas que se respetan acá:
#   - Las contraseñas se generan EN el servidor y no se imprimen nunca.
#   - Se verifica que las cuentas nuevas pueden entrar ANTES de tocar el
#     ecosystem. Si no pueden, el archivo no se toca y los bots siguen andando.
#   - Backup del ecosystem antes de escribirlo, y restauración automática si el
#     bot no vuelve a levantar.
#   - Idempotente: si ya está aplicado, no vuelve a rotar nada.
set -euo pipefail

ECO=/opt/cepi/ecosystem.config.cjs
API=http://localhost:3001
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

if sudo grep -q 'bot-whatsapp@cepi.local' "$ECO"; then
  log "el ecosystem ya apunta a las cuentas de servicio — nada que hacer"
  exit 0
fi

# ── 1. Contraseñas nuevas, solo hex: no pelean con sed, JS ni psql ───────────
PW_WA=$(openssl rand -hex 24)
PW_TG=$(openssl rand -hex 24)

# ── 2. Hash con el mismo bcryptjs que valida el backend ──────────────────────
cd /opt/cepi/TodoERP/backend
HASH_WA=$(PW="$PW_WA" node -e 'console.log(require("bcryptjs").hashSync(process.env.PW,10))')
HASH_TG=$(PW="$PW_TG" node -e 'console.log(require("bcryptjs").hashSync(process.env.PW,10))')
log "hashes generados"

# ── 3. Aplicar en la base ────────────────────────────────────────────────────
sudo -u postgres psql -d cepi -v ON_ERROR_STOP=1 -q \
  -c "UPDATE users SET password_hash = '$HASH_WA', updated_at = NOW() WHERE email = 'bot-whatsapp@cepi.local'" \
  -c "UPDATE users SET password_hash = '$HASH_TG', updated_at = NOW() WHERE email = 'bot-telegram@cepi.local'"
log "contraseñas aplicadas en la base"

# ── 4. VERIFICAR antes de tocar nada vivo ────────────────────────────────────
probar() {
  local email="$1" pw="$2"
  local code
  code=$(curl -s -o /tmp/login.$$ -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
         --data "$(PW="$pw" EM="$email" node -e 'console.log(JSON.stringify({email:process.env.EM,password:process.env.PW}))')" \
         "$API/api/auth/login")
  local tiene_token=no
  grep -q '"token"' /tmp/login.$$ && tiene_token=si
  rm -f /tmp/login.$$
  [[ "$code" == "200" && "$tiene_token" == "si" ]] || { log "ERROR: $email no pudo entrar (HTTP $code)"; return 1; }
  log "$email entra correctamente"
}
probar 'bot-whatsapp@cepi.local' "$PW_WA"
probar 'bot-telegram@cepi.local' "$PW_TG"

# ── 5. Recién ahora, el ecosystem ────────────────────────────────────────────
BK="${ECO}.bak.$(date +%s)"
sudo cp "$ECO" "$BK"
log "backup en $BK"

sudo PW_WA="$PW_WA" PW_TG="$PW_TG" python3 - "$ECO" <<'PY'
import os, re, sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()

def fijar(clave, valor):
    global s
    pat = re.compile(r"^(\s*)" + clave + r":\s*'[^']*',", re.M)
    nuevo = r"\g<1>" + clave + ": '" + valor + "',"
    s2, n = pat.subn(nuevo, s, count=1)
    assert n == 1, f"no se encontró {clave}"
    s = s2

def agregar_tras(ancla, linea):
    global s
    pat = re.compile(r"^(\s*)" + ancla + r":.*$", re.M)
    m = pat.search(s)
    assert m, f"no se encontró el ancla {ancla}"
    sangria = m.group(1)
    if linea.split(':')[0].strip() in s:
        return
    s = s[:m.end()] + "\n" + sangria + linea + s[m.end():]

fijar('WHATSAPP_BOT_EMAIL',    'bot-whatsapp@cepi.local')
fijar('WHATSAPP_BOT_PASSWORD', os.environ['PW_WA'])
fijar('TELEGRAM_BOT_EMAIL',    'bot-telegram@cepi.local')
fijar('TELEGRAM_BOT_PASSWORD', os.environ['PW_TG'])

# La organización acota el canal; sin ella el bot ya no resuelve nada.
agregar_tras('WHATSAPP_BOT_PASSWORD', "WHATSAPP_BOT_ORG: 'cepi',")
agregar_tras('TELEGRAM_BOT_PASSWORD', "TELEGRAM_BOT_ORG: 'cepi',")
agregar_tras('WHATSAPP_BOT_ORG', "WHATSAPP_BOT_AUTOALTA: '1',")
agregar_tras('TELEGRAM_BOT_ORG', "TELEGRAM_BOT_AUTOALTA: '1',")

p.write_text(s)
print("ecosystem actualizado")
PY

node --check "$ECO" 2>/dev/null || sudo node -e "require('$ECO')" >/dev/null 2>&1 || {
  log "ERROR: el ecosystem quedó inválido. Restaurando."
  sudo cp "$BK" "$ECO"; exit 1
}

# ── 6. Reiniciar y comprobar que vuelve ──────────────────────────────────────
pm2 restart cepi-bot --update-env >/dev/null
sleep 8
if ! curl -fsS -o /dev/null "http://localhost:3002/health"; then
  log "ERROR: cepi-bot no responde. Restaurando el ecosystem y reiniciando."
  sudo cp "$BK" "$ECO"; pm2 restart cepi-bot --update-env >/dev/null; sleep 6
  curl -fsS -o /dev/null "http://localhost:3002/health" && log "revertido, el bot volvió" || log "revertido, PERO el bot sigue sin responder"
  exit 1
fi

log "cepi-bot arriba con las cuentas de servicio"
log "LISTO. admin@erp.com ya no la usa ningún bot."
