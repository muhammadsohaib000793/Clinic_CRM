// Ingests normalized inbound messages: upserts customer + conversation, persists
// the message (idempotently), updates the 24h-window anchor (lastInboundAt), and
// fires the AI auto-responder when all agents are offline.
import { prisma } from '../db/prisma.js';
import { normalizeWebhook } from './normalize.js';
import { emitAll } from '../realtime/emitter.js';
import { EVENTS } from '../realtime/events.js';
import { createLogger } from '../lib/logger.js';
import { maybeAutoRespond } from '../services/ai/agentRunner.js';

const log = createLogger('ingest');

async function findOrCreateCustomer(channel, externalId, senderName) {
  const identity = await prisma.channelIdentity.findUnique({
    where: { channel_externalId: { channel, externalId } },
    include: { customer: true },
  });
  if (identity) return identity.customer;

  // A customer who messages us first is opted-in for in-window replies.
  return prisma.customer.create({
    data: {
      name: senderName || `Guest ${externalId.slice(-4)}`,
      optedIn: true,
      optInAt: new Date(),
      identities: { create: { channel, externalId } },
    },
  });
}

async function findOrCreateConversation(customerId, channel) {
  return prisma.conversation.upsert({
    where: { customerId_channel: { customerId, channel } },
    update: {},
    create: { customerId, channel, status: 'OPEN' },
  });
}

async function ingestInbound(n) {
  const customer = await findOrCreateCustomer(n.channel, n.externalId, n.senderName);
  const conversation = await findOrCreateConversation(customer.id, n.channel);
  const sentAt = new Date(n.timestampMs);

  // Idempotency: dedupe Meta's webhook retries by external message id.
  let message;
  try {
    message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'CUSTOMER',
        direction: 'INBOUND',
        channel: n.channel,
        content: n.text || '',
        externalMessageId: n.externalMessageId || null,
        sentAt,
      },
    });
  } catch (e) {
    if (e.code === 'P2002') {
      log.debug('Duplicate inbound ignored', { externalMessageId: n.externalMessageId });
      return { deduped: true, conversationId: conversation.id };
    }
    throw e;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastInboundAt: sentAt,
      lastMessageAt: sentAt,
      status: conversation.status === 'CLOSED' ? 'OPEN' : conversation.status,
    },
  });

  emitAll(EVENTS.MESSAGE_NEW, { conversationId: conversation.id, message });
  emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId: conversation.id });

  // AI coverage when staff are offline — never blocks the webhook ack.
  maybeAutoRespond(conversation.id).catch((err) =>
    log.error('AI auto-respond failed', { conversationId: conversation.id, error: err.message }),
  );

  return { conversationId: conversation.id, messageId: message.id };
}

export async function handleWebhookPayload(body) {
  const normalized = normalizeWebhook(body);
  const results = [];
  for (const n of normalized) {
    if (!n.externalId) continue;
    try {
      results.push(await ingestInbound(n));
    } catch (err) {
      log.error('Ingest failed', { channel: n.channel, error: err.message });
    }
  }
  return results;
}
