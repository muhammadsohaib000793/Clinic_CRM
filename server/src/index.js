// CRM backend entrypoint: Express API + Meta webhook + Socket.IO + red-flag cron.
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { env, envReport } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { webhookRouter } from './webhook/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { initSocket } from './realtime/socket.js';
import { startRedflagScanner } from './services/redflag/scanner.js';
import { prisma } from './db/prisma.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('server');
const app = express();

app.use(cors({ origin: env.clientOrigin, credentials: true }));
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

app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
initSocket(server);
startRedflagScanner();

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
