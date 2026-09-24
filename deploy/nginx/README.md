# Config de nginx de producción

**Foto** de lo que corre en el EC2 de prod (`3.23.236.49`) al **2026-09-24**. Hasta
hoy esta config no estaba en ningún repo: vivía solo en el servidor, y un `certbot`
o una edición a mano se perdían sin dejar rastro.

| Archivo | En el servidor |
|---|---|
| `cepi.conf` | `/etc/nginx/sites-available/cepi` — `casos.cepi.ec` + `telemedicina.cepi.ec` |
| `cepi-seguridad.conf` | `/etc/nginx/snippets/cepi-seguridad.conf` — cabeceras de seguridad |

La consola tiene la suya en su propio repo (`cepi-console/deploy/console.cepi.ec.conf`).

## El deploy NO administra nginx

`docs/DEPLOY.md` lo dice y sigue siendo cierto: un push a `master` no toca esta
config. Se aplica a mano:

```bash
scp deploy/nginx/cepi-seguridad.conf prod:/tmp/
ssh prod 'sudo cp /tmp/cepi-seguridad.conf /etc/nginx/snippets/ && sudo nginx -t && sudo systemctl reload nginx'
```

Por eso esto es una **foto y no la fuente de verdad**. Si cambiás algo en el
servidor, traelo de vuelta:

```bash
ssh prod 'sudo cat /etc/nginx/sites-available/cepi' > deploy/nginx/cepi.conf
```

Las líneas `# managed by Certbot` las escribió certbot al emitir el certificado:
no se editan a mano ni se copian a un servidor nuevo tal cual.

## La trampa del `add_header`

En nginx un `add_header` de un nivel más específico **no se suma** a los del padre:
los reemplaza. Como la app sirve el HTML por `try_files … /index.html`, la petición
cae por redirección interna en `location = /index.html`, que declara su propio
`Cache-Control` — y sin repetir ahí las cabeceras de seguridad, **la página salía
sin ninguna mientras los assets sí las traían**. Eso es justo lo que despista al
revisarlo: mirás un `.js`, ves las cabeceras, y concluís que está bien.

Por eso el snippet se incluye en el `server` **y** en cada `location` que declare
un `add_header` propio. Si agregás otro `location` con `add_header`, incluí el
snippet ahí también.

## Qué no está puesto, a propósito

- **HSTS** (`Strict-Transport-Security`): los navegadores lo cachean por `max-age`
  y volver atrás es lento y doloroso. Se agrega cuando se decida explícitamente.
- **`X-Frame-Options: DENY`**: se usa `SAMEORIGIN` para no romper un enmarcado del
  mismo origen (la Ficha que cargan las apps nativas). El clickjacking de terceros
  queda bloqueado igual.

## Pendiente conocido

`/manifest.webmanifest` se sirve como `application/octet-stream` porque nginx no
trae su mime type. **No rompe nada** — verificado en Chrome: el manifest parsea, el
service worker queda activo y `beforeinstallprompt` se dispara, o sea que la PWA
sigue siendo instalable. `nosniff` no bloquea el destino `manifest`. Lo correcto
igual sería declararlo:

```nginx
location = /manifest.webmanifest {
    add_header Cache-Control "no-cache";
    include snippets/cepi-seguridad.conf;
    types { } default_type application/manifest+json;
    try_files $uri =404;
}
```
