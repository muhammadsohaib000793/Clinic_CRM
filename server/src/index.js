// CRM backend entrypoint: Express API + Meta webhook + Socket.IO + red-flag cron.
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env, envReport } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { webhookRouter } from './webhook/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/security.js';
import { initSocket } from './realtime/socket.js';
import { startRedflagScanner } from './services/redflag/scanner.js';
import { startReminderScheduler } from './services/reminders/scheduler.js';
import { startLowStockWatcher } from './services/inventory/service.js';
import { prisma } from './db/prisma.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('server');
const app = express();

app.disable('x-powered-by');
// Trust the first proxy hop (tunnel / reverse proxy in front of Node) so req.ip
// resolves to the real client — otherwise the per-IP rate limiter would bucket
// every client under the proxy's address (a shared bucket = auth-DoS risk).
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors({ origin: env.clientOrigin, credentials: true }));
// Clinical attachments are posted as base64 JSON, which inflates the payload by
// ~33% — a 5 MB file needs ~6.7 MB of body. Give that ONE path a larger limit
// while the global limit below stays tight for the public webhook surface.
// body-parser sets req._body, so the global parser skips what this one handled.
app.use('/api/clinical', express.json({ limit: '9mb' }));

// Capture the raw body so the webhook can verify Meta's HMAC signature.
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use('/webhook', webhookRouter);
app.use('/api', apiRouter);

// In production, serve the built React frontend from this same service, so one
// Railway deployment hosts the API, the Meta webhook, and the UI together.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path === '/health') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  log.info('Serving built frontend from client/dist');
}

app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
initSocket(server);
startRedflagScanner();
startReminderScheduler(); // appointment reminders (WhatsApp template / email / SMS)
startLowStockWatcher(); // hourly inventory low-stock alert

// Reset stale presence on boot: no sockets are connected yet, so every agent is
// offline. Prevents a prior crash from leaving agents "ONLINE" and suppressing
// AI after-hours coverage.
prisma.agent
  .updateMany({ data: { status: 'OFFLINE' } })
  .catch((e) => log.warn('Could not reset agent presence on boot', { error: e.message }));

server.listen(env.port, () => {
  log.info(`CRM backend listening on http://localhost:${env.port}`);
  log.info('Environment report', envReport());
  log.info(`Meta webhook URL: ${env.publicBaseUrl}/webhook`);
  if (!env.whatsapp.accessToken) {
    log.warn('WhatsApp token missing -> WhatsApp sends run in DRY-RUN mode.');
  }
  if (!env.meta.appSecret) {
    log.warn('META_APP_SECRET missing -> webhook signature verification is SKIPPED (dev mode).');
  }
});

async function shutdown(signal) {
  log.info(`Received ${signal}, shutting down…`);
  await prisma.$disconnect().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server };
