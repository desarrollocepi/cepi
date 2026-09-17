#!/usr/bin/env bash
# Trae TodoERP a ./TodoERP en el runner de CI.
#
# TodoERP es un repo privado e independiente (desarrollocepi/TodoERP) que vive dentro
# de la carpeta de cepi; cepi no lo registra. Se clona con una deploy key de solo
# lectura (secret TODOERP_DEPLOY_KEY).
#
#   ci-todoerp.sh <ref>    ref = rama o SHA
#
# Deja el SHA resuelto en $GITHUB_OUTPUT (sha=…): el job de deploy clona ese mismo
# commit, no la rama, para no desplegar algo que llegó a main después de los tests.
set -euo pipefail

REF=${1:?uso: ci-todoerp.sh <rama|sha>}
: "${TODOERP_DEPLOY_KEY:?falta el secret TODOERP_DEPLOY_KEY}"
: "${GITHUB_ED25519:?falta la clave de host de github.com}"

install -d -m 700 ~/.ssh
printf '%s\n' "$TODOERP_DEPLOY_KEY" > ~/.ssh/todoerp
chmod 600 ~/.ssh/todoerp
grep -qxF "$GITHUB_ED25519" ~/.ssh/known_hosts 2>/dev/null || echo "$GITHUB_ED25519" >> ~/.ssh/known_hosts
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/todoerp -o IdentitiesOnly=yes"

git init -q TodoERP
git -C TodoERP remote add origin git@github.com:desarrollocepi/TodoERP.git
git -C TodoERP fetch -q --depth 1 origin "$REF"
git -C TodoERP checkout -q FETCH_HEAD

SHA=$(git -C TodoERP rev-parse HEAD)
echo "TodoERP $REF → $SHA"
if [[ -n ${GITHUB_OUTPUT:-} ]]; then echo "sha=$SHA" >> "$GITHUB_OUTPUT"; fi
