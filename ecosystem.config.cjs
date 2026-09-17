/**
 * cepi unified PM2 ecosystem.
 *
 * Phase 1 of the medical-assistant project (PAPER §15) only needs the
 * TodoERP backend + admin frontend up. As later phases land:
 *   Fase 4 → adds `cepi-bot` (the conversational medical agent)
 *           and `cepi-medical-frontend` (the unified medical UI).
 *   Fase 6 → adds the Python ISIC inference service.
 *
 * The MCP server (`TodoERP/mcp`) is stdio-based and is spawned by the
 * agent process, so it does not appear here.
 *
 * The legacy CEPI chatbot at `backend/server.js` is intentionally NOT
 * managed by PM2 anymore; it will be replaced by `cepi-bot` in Fase 4.
 *
 * Windows note: PM2 mishandles `script: 'npm'` on Windows (it tries to
 * parse npm.cmd as JS), so we invoke node directly instead.
 */
module.exports = {
  apps: [
    {
      name: 'todoerp-backend',
      script: 'node',
      args: '--no-warnings=ExperimentalWarning --loader ts-node/esm src/app.ts',
      cwd: './TodoERP/backend',
      watch: false,
      env: {
        NODE_ENV: 'development',
        STAGE: 'DEVELOP',
        PORT: 3001,
        CEPI_MEDICAL: '1',
      },
      max_memory_restart: '500M',
    },
    {
      name: 'todoerp-frontend',
      script: 'node',
      args: 'node_modules/vite/bin/vite.js --host',
      cwd: './TodoERP/frontend',
      watch: false,
      env: {
        NODE_ENV: 'development',
        VITE_API_URL: 'http://localhost:3001',
        // El ERP se sirve en raíz '/' en :5173 (acceso directo local). NO se
        // expone por el túnel ngrok — ver ngrok.yml. Por eso no lleva VITE_BASE.
      },
      max_memory_restart: '500M',
    },
    {
      // Fase 4 — conversational agent. Spawns the TodoERP MCP server as a
      // child stdio process per chat turn; auth flows via the user's JWT.
      name: 'cepi-bot',
      script: 'node',
      args: '--no-warnings=ExperimentalWarning --loader ts-node/esm src/server.ts',
      cwd: './cepi-bot',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 3002,
        TODOERP_API_URL: 'http://localhost:3001',
        CEPI_LLM_PROVIDER: 'deepseek',
        // ── WhatsApp webhook (segundo listener en el mismo proceso) ──
        WHATSAPP_WEBHOOK_PORT: 9997,
        WHATSAPP_VERIFY_TOKEN: 'mywpverifytoken',    // el mismo configurado en Meta
        WHATSAPP_BOT_EMAIL: 'admin@erp.com',        // service account → JWT por turno
        WHATSAPP_BOT_PASSWORD: 'Admin123!',
        // Credenciales Meta Cloud API (envío real de respuestas).
        WHATSAPP_TOKEN:    'EAAcujNkZCcnEBRlT45OP1SGYhCbgaZCCZAk9SGi0OR7M7KO4bso2iYpwmOMEsgKvgcZBcZAKLMZBrAXLdIQsodNHNdrTOAZC3gOmp0m1gTZBbLCGJbZAH7sWF1ndVU6058v5a22pJZC8jcQ9eNhijlRarJFrD2ZBG0Bym8mHvpC43nZAAKZCCSnWgeqwDYqOJNxW5AGDYUxCV8g88cJZAZAxMCvX0v4tEM5azdMP8Vw1Kju4mgLusAmnbsHHH28kUyumReZCdsbf72xLFexHuGklFZAme0AuVGX7DQKrT75IZD',
        WHATSAPP_PHONE_ID: '1195901160263503',
        // ── Telegram webhook (tercer listener en el mismo proceso) ──
        // El token, el secret y TELEGRAM_PUBLIC_URL viven en cepi-bot/.env
        // (gitignored). Acá solo el puerto y la cuenta de servicio.
        TELEGRAM_WEBHOOK_PORT: 9998,
        TELEGRAM_BOT_EMAIL: 'admin@erp.com',   // service account → JWT por turno
        TELEGRAM_BOT_PASSWORD: 'Admin123!',
      },
      max_memory_restart: '500M',
    },
    {
      // Fase 4 — medical UI. Vue 3 + Vite. Proxies /api/auth and
      // /api/entities to TodoERP, /api/bot to cepi-bot.
      name: 'cepi-frontend',
      script: 'node',
      args: 'node_modules/vite/bin/vite.js --host --port 5174',
      cwd: './cepi-frontend',
      watch: false,
      env: { NODE_ENV: 'development' },
      max_memory_restart: '500M',
    },
    {
      // Fase 6 — Python ISIC inference service (FastAPI, stub mode).
      // Disabled by default; start with: pm2 start ecosystem.config.cjs --only cepi-isic
      // Requires the venv set up per cepi-isic/README.md.
      name: 'cepi-isic',
      script: '.venv/bin/uvicorn',
      args: 'app:app --host 0.0.0.0 --port 8000',
      cwd: './cepi-isic',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      env: { CEPI_ISIC_PORT: 8000 },
      max_memory_restart: '1G',
    },
    {
      // Túnel ngrok hacia el dev server de Vite (5174), que enruta por path.
      // Dominio fijo `known-simple-gull.ngrok-free.app` → expone frontend +
      // API + webhooks de WhatsApp (/whatsapp) y Telegram (/telegram).
      // Mergea dos configs: el del HOME aporta el authtoken (secreto, fuera
      // del repo); ./ngrok.yml aporta el endpoint (versionado). Arranca solo
      // el endpoint `cepi` por nombre.
      name: 'ngrok',
      script: 'ngrok',
      args: `start cepi --config ${process.env.HOME}/.config/ngrok/ngrok.yml --config ./ngrok.yml`,
      cwd: './',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_memory_restart: '200M',
    },
  ],
};
