#!/usr/bin/env node
/**
 * Archivos de imagen para los datos ficticios (SOLO DESARROLLO).
 *
 * El seeder crea imágenes clínicas (`entity_clinical_image`) que apuntan a un adjunto, pero
 * el archivo no existe en `uploads/`: la suite de tests borra esa carpeta (`tests/entities/
 * attachments.test.ts`). Sin archivo, la galería (PAPER §24.2.1) se ve vacía en local y no
 * hay forma de probarla de verdad.
 *
 * Este script, para cada imagen clínica sin archivo, deja uno (copia de una foto de muestra)
 * y registra el adjunto si falta. Idempotente: lo que ya está no se toca.
 *
 *   node scripts/imagenes-ficticias.mjs
 *
 * Se niega a correr si la base no es local.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(raiz, 'TodoERP/backend/package.json'));
const pg = require('pg');
require('dotenv').config({ path: path.join(raiz, 'TodoERP/backend/.env') });

const host = process.env.DB_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`imagenes-ficticias: ${host} no es local. Este script solo corre contra la base local.`);
  process.exit(1);
}

const subidas = path.join(raiz, 'TodoERP/backend', process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(subidas, { recursive: true });

/** Una foto de muestra: la primera que haya en uploads, o un JPEG mínimo generado acá. */
function fotoDeMuestra() {
  const existente = fs.readdirSync(subidas).find((f) => /\.(jpe?g|png)$/i.test(f));
  if (existente) return fs.readFileSync(path.join(subidas, existente));
  // JPEG 8×8 gris, suficiente para que el visor muestre algo.
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAHwAAAQUBAQEB' +
    'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
    'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiv/9k=',
    'base64'
  );
}

const db = new pg.Pool({
  host, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

try {
  const muestra = fotoDeMuestra();
  const hash = crypto.createHash('sha256').update(muestra).digest('hex');
  const nombre = `${hash}.jpg`;
  const destino = path.join(subidas, nombre);
  if (!fs.existsSync(destino)) fs.writeFileSync(destino, muestra);

  const { rows } = await db.query(
    `SELECT i.id, i.attachment_id, i.org_id, i.created_by
       FROM entity_clinical_image i
      WHERE i.attachment_id IS NOT NULL AND i.attachment_id <> ''
        AND i.attachment_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.id::text = i.attachment_id)`
  );
  for (const img of rows) {
    await db.query(
      `INSERT INTO attachments (id, entity_id, field_key, filename, original_name, mimetype, size, created_by, org_id)
       VALUES ($1, $2, 'imagenes', $3, 'ficticia.jpg', 'image/jpeg', $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [img.attachment_id, img.id, nombre, muestra.length, img.created_by, img.org_id]
    );
  }

  // Y los adjuntos que sí están registrados pero perdieron su archivo.
  const { rows: sinArchivo } = await db.query('SELECT id, filename FROM attachments');
  let repuestos = 0;
  for (const a of sinArchivo) {
    const ruta = path.join(subidas, a.filename || '');
    if (a.filename && !fs.existsSync(ruta)) {
      fs.writeFileSync(ruta, muestra);
      repuestos++;
    }
  }
  console.log(`adjuntos creados: ${rows.length} · archivos repuestos: ${repuestos} · carpeta: ${subidas}`);
} finally {
  await db.end();
}
