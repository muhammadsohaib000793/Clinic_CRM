// Meta webhook router: GET verification handshake + POST inbound receiver.
import { Router } from 'express';
import { env } from '../config/env.js';
import { verifySignature } from './signature.js';
import { handleWebhookPayload } from './receive.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('webhook');
export const webhookRouter = Router();

// GET /webhook — Meta verification handshake (uses WEBHOOK_VERIFY_TOKEN).
webhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && env.webhookVerifyToken && token === env.webhookVerifyToken) {
    log.info('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  log.warn('Webhook verification failed', { mode, tokenMatch: token === env.webhookVerifyToken });
  return res.sendStatus(403);
});

// POST /webhook — inbound messages from all channels.
webhookRouter.post('/', (req, res) => {
  const sig = verifySignature(req);
  if (!sig.ok) {
    log.warn('Rejected webhook: bad signature', { reason: sig.reason });
    return res.sendStatus(403);
  }
  // Ack immediately (Meta requires a fast 200); process asynchronously.
  res.sendStatus(200);
  handleWebhookPayload(req.body).catch((err) =>
    log.error('Webhook processing failed', { error: err.message }),
  );
});
