#!/usr/bin/env node
/**
 * Cuentas de prueba del revisor de la App Store en el STACK LOCAL (PAPER §24.7, D-Aux-21).
 *
 * Las crea por el mismo camino que una cuenta real: registro → código de verificación →
 * aprobación de un admin con rol clínico y membresía SOLO en la org de pruebas (sandbox).
 * El código no llega por email en local (sin BREVO_API_KEY): se fija uno conocido en la base,
 * que es lo único que no pasa por la API.
 *
 *   node scripts/cuenta-revisor.mjs
 *
 * Crea tres cuentas con sufijo aleatorio (la activa, una para borrar y una pendiente) e
 * imprime las variables que lee `RevisorUITests`:
 *
 *   eval "$(node scripts/cuenta-revisor.mjs)" && xcodebuild test … -only-testing:CEPITelemedicinaUITests/RevisorUITests
 *
 * Nunca contra producción: se niega si la API no es local.
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(raiz, 'TodoERP/backend/package.json'));
const bcrypt = require('bcryptjs');
const pg = require('pg');
require('dotenv').config({ path: path.join(raiz, 'TodoERP/backend/.env') });

const API = process.env.CEPI_API_BASE || 'http://127.0.0.1:3001';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) {
  console.error(`cuenta-revisor: ${API} no es local. Este script solo corre contra el stack local.`);
  process.exit(1);
}
const CLAVE = 'Revisor2026!';
const ORG_PRUEBAS = process.env.CEPI_ORG_PRUEBAS || 'cepi-testing';
const ROL = process.env.CEPI_ROL_REVISOR || 'medico_primario';

const db = new pg.Pool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

async function llamar(metodo, ruta, cuerpo, token) {
  const r = await fetch(API + '/api' + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

async function crear(email, { aprobar }) {
  await llamar('POST', '/auth/register', { name: 'Revisor App Store', email, password: CLAVE });
  const codigo = await bcrypt.hash('123456', 10);
  const vence = new Date(Date.now() + 20 * 60_000).toISOString();
  await db.query(
    `UPDATE users SET data = data || jsonb_build_object('verify_code_hash', $2::text, 'verify_code_exp', $3::text, 'verify_attempts', 0)
      WHERE email = $1`,
    [email, codigo, vence]
  );
  await llamar('POST', '/auth/verify-email', { email, code: '123456' });
  if (!aprobar) return;

  const { rows: [usuario] } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  const { rows: [org] } = await db.query('SELECT id FROM organizations WHERE slug = $1', [ORG_PRUEBAS]);
  if (!org) throw new Error(`no existe la org ${ORG_PRUEBAS}`);
  const admin = await llamar('POST', '/auth/login', { email: 'admin@erp.com', password: 'Admin123!' });
  const { roles } = await llamar('GET', '/admin/roles', null, admin.token);
  const rol = roles.find((r) => r.name === ROL);
  if (!rol) throw new Error(`no existe el rol ${ROL}`);
  await llamar('PATCH', `/admin/users/${usuario.id}`, { role_id: rol.id }, admin.token);
  await llamar('PUT', `/admin/users/${usuario.id}/orgs`, { org_ids: [org.id] }, admin.token);

  const sesion = await llamar('POST', '/auth/login', { email, password: CLAVE });
  const { user } = await llamar('GET', '/auth/me', null, sesion.token);
  const orgs = (user.orgs || []).map((o) => o.slug);
  if (orgs.length !== 1 || orgs[0] !== ORG_PRUEBAS) throw new Error(`${email} quedó en ${orgs.join(',')}`);
}

try {
  const sufijo = randomBytes(3).toString('hex');
  const cuentas = {
    CEPI_REVISOR_EMAIL: [`revisor-${sufijo}@cepi.local`, true],
    CEPI_REVISOR_BORRAR: [`revisor-borrar-${sufijo}@cepi.local`, true],
    CEPI_REVISOR_PENDIENTE: [`revisor-pendiente-${sufijo}@cepi.local`, false],
  };
  for (const [variable, [email, aprobar]] of Object.entries(cuentas)) {
    await crear(email, { aprobar });
    console.log(`export TEST_RUNNER_${variable}=${email}`);
  }
  console.log(`# clave de las tres: ${CLAVE}`);
} finally {
  await db.end();
}
