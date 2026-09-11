# Espejo iCloud Drive → S3

Copia one-way de una carpeta compartida de iCloud Drive a un bucket S3, corriendo
en el EC2 de prod (`3.23.236.49`). Es la primera mitad del camino; la ingesta de
esos archivos al pipeline de casos de CEPI va aparte.

**Nunca borra**: usa `rclone copy`, no `rclone sync`. Si un archivo desaparece de
iCloud, la copia en S3 se queda. El bucket además tiene versionado.

## Piezas

| Archivo | Qué es |
|---|---|
| `sync.sh` | el copiador. Lock, límites de memoria, estado en JSON, alerta en fallo |
| `cepi-icloud-sync.service` | unidad oneshot que lo ejecuta |
| `cepi-icloud-sync.timer` | lo dispara cada 10 min |
| `/opt/cepi/.secrets.d/icloud-s3.env` | configuración (600, git-ignored) |
| `/opt/cepi/.secrets.d/rclone.conf` | remotes de rclone, incluye la sesión de iCloud (600) |
| `/var/lib/cepi/icloud-sync.status.json` | resultado del último corrida |

## Requisito: rclone ≥ 1.68

El backend `iclouddrive` no existe antes de esa versión, y el de Ubuntu 26.04 es
1.60. Hay que instalar el binario oficial:

```bash
cd /tmp
curl -fsSLO https://downloads.rclone.org/rclone-current-linux-amd64.zip
unzip -q -o rclone-current-linux-amd64.zip -d /tmp/rclone-x
sudo install -m 755 "$(find /tmp/rclone-x -name rclone -type f | head -1)" /usr/local/bin/rclone
```

Ya hecho en prod: **rclone v1.75.1**.

## Setup del remote de iCloud (interactivo, una vez)

El backend pide el Apple ID y la contraseña **real** de la cuenta (la contraseña
específica de app no funciona), y luego un código 2FA de 6 dígitos que hay que
leer en un dispositivo Apple de confianza en ese momento.

```bash
rclone config --config /opt/cepi/.secrets.d/rclone.conf
#   n) New remote
#   name> icloud
#   Storage> iclouddrive
#   apple_id> <el Apple ID>
#   password> <contraseña real de la cuenta>
#   -> pide el código de 6 dígitos
chmod 600 /opt/cepi/.secrets.d/rclone.conf
```

Verificar que se ve la carpeta compartida:

```bash
rclone lsd icloud: --config /opt/cepi/.secrets.d/rclone.conf
```

### El trust token caduca (~30 días)

Ese login deja un `trust_token` en `rclone.conf` con vencimiento. Cuando caduca,
el sync empieza a fallar con 401/421 y **hace falta un humano con el dispositivo
Apple** para reingresar el código:

```bash
rclone config reconnect icloud: --config /opt/cepi/.secrets.d/rclone.conf
```

`sync.sh` detecta el fallo, lo escribe en el status JSON y corre
`ICLOUD_SYNC_ALERT_CMD` si está configurado. Sin esa alerta el espejo se muere en
silencio — configurarla no es opcional.

## Setup del remote de S3

Ya hecho en prod. El EC2 lleva el rol de instancia `cepi-icloud-sync`, así que el
remote **no tiene claves**: las credenciales temporales salen del metadata.

```ini
[s3cepi]
type = s3
provider = AWS
env_auth = true
region = us-east-2
storage_class = STANDARD
server_side_encryption = AES256
no_check_bucket = true
```

**`no_check_bucket = true` no es opcional.** Sin eso rclone intenta un
`CreateBucket` antes de la primera subida para verificar que el bucket existe, la
policy se lo niega y todo el sync muere con
`IllegalLocationConstraintException`, que no se parece en nada al problema real.

Ojo con la ruta: `/opt/cepi/.secrets` **es un archivo** que ya usan los backends.
Lo de rclone vive en `/opt/cepi/.secrets.d/` (directorio, 700).

El rol se crea con `crear-rol-iam.sh` (ver ahí). La política está en
`iam-policy.json`: listar el bucket, escribir bajo `inbox/`, **sin borrado**. Por
eso el archivo de prueba `inbox/.rclone-prueba` sigue ahí — el EC2 no puede
borrarlo, y la ingesta debe ignorar los que empiezan con punto.

## Configuración

`/opt/cepi/.secrets.d/icloud-s3.env`:

```sh
ICLOUD_PATH="Nombre De La Carpeta Compartida"
S3_BUCKET="cepi-icloud-648395693289"
S3_PREFIX="inbox"
# Opcional pero recomendado: aviso cuando el sync falla.
ICLOUD_SYNC_ALERT_CMD='curl -s -X POST "https://api.telegram.org/bot$TG_TOKEN/sendMessage" -d chat_id=$TG_CHAT -d text="$ICLOUD_SYNC_MSG" >/dev/null'
```

## Instalar el timer

```bash
sudo cp /opt/cepi/scripts/icloud-s3/cepi-icloud-sync.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cepi-icloud-sync.timer
systemctl list-timers cepi-icloud-sync.timer
```

## Operación

```bash
sudo systemctl start cepi-icloud-sync.service   # corrida manual
journalctl -u cepi-icloud-sync -n 100 --no-pager
cat /var/lib/cepi/icloud-sync.status.json
```

Prueba en seco antes de la primera corrida real:

```bash
rclone copy icloud:"$ICLOUD_PATH" s3cepi:"$S3_BUCKET/inbox" \
  --config /opt/cepi/.secrets.d/rclone.conf --dry-run -v
```

## Cuidados

- Son **imágenes clínicas**: el bucket va privado, con Block Public Access, SSE y
  versionado. Nada se sirve al navegador sin URL firmada.
- La t3.micro tiene 908 MB de RAM y 8.9 GB libres. El servicio está capado a
  `MemoryMax=300M` y `--transfers 2` justamente para no tumbar los backends.
  rclone hace streaming: no baja la carpeta entera a disco.
- El `.env` y el `rclone.conf` contienen la contraseña del Apple ID. `chmod 600`,
  fuera de git, y no salen del EC2.
