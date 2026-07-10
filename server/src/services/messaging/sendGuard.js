// =============================================================================
//  sendGuard — THE single outbound choke point (§9A ban-prevention).
// -----------------------------------------------------------------------------
//  EVERY outbound message path in the system (agent reply, AI auto-reply,
//  appointment confirmation, re-engagement) MUST call send() here. No other
//  module is allowed to call a channel sender directly.
//
//  Rules enforced, in order:
//   1. Recipient identity must exist for the channel.
//   2. 24h customer-service window:
//        - INSIDE  -> free-form allowed.
//        - OUTSIDE -> ONLY an APPROVED template; free-form is rejected.
//   3. Opt-in gate: business-initiated / out-of-window sends require opt-in.
//        (A customer messaging within 24h is itself consent to reply in-window.)
//   4. Template validity: must exist AND be APPROVED.
//   5. WhatsApp test-phase allowlist: only the <=5 verified recipients.
//   6. Instagram rolling hourly cap (~200/hr, kept below with a margin).
//   7. No empty free-form content.
//  Every decision (ALLOWED or BLOCKED) is written to OutboundLog for audit.
// =============================================================================
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import {
  CHANNELS,
  BLOCK_REASONS,
  ALLOW_REASONS,
  SEND_MODE,
  SENDER_TYPES,
} from '../../config/constants.js';
import { isWindowOpen, describeWindow } from './windowPolicy.js';
import { reserveInstagramSlot, releaseReservation, instagramHourlyUsage } from './rateLimiter.js';
import { lookupTemplate, renderTemplateBody } from './templates.js';
import { getChannelSender } from './channels/index.js';
import { emitAll } from '../../realtime/emitter.js';
import { EVENTS } from '../../realtime/events.js';
import { NotFoundError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('sendGuard');

// ---- Pure policy evaluation (window + opt-in + template + content) ----------
// No side effects; used by both send() and previewPolicy().
export function evaluatePolicy({
  lastInboundAt,
  optedIn,
  content,
  templateName,
  templateLookup,
  channel,
  now = new Date(),
}) {
  const windowOpen = isWindowOpen(lastInboundAt, now);
  const hasInboundEver = !!lastInboundAt;
  const block = (reason, mode = null) => ({ allowed: false, reason, mode });
  const allow = (mode, reason) => ({ allowed: true, reason, mode });

  // --- Template path -------------------------------------------------------
  if (templateName) {
    if (!templateLookup?.found) return block(BLOCK_REASONS.TEMPLATE_NOT_FOUND, SEND_MODE.TEMPLATE);
    if (!templateLookup.approved) return block(BLOCK_REASONS.TEMPLATE_NOT_APPROVED, SEND_MODE.TEMPLATE);
    // Business-initiated / out-of-window template requires opt-in.
    if (!windowOpen && !optedIn) return block(BLOCK_REASONS.NOT_OPTED_IN, SEND_MODE.TEMPLATE);
    return allow(SEND_MODE.TEMPLATE, windowOpen ? ALLOW_REASONS.WITHIN_WINDOW : ALLOW_REASONS.APPROVED_TEMPLATE);
  }

  // --- Free-form path ------------------------------------------------------
  if (!content || !String(content).trim()) return block(BLOCK_REASONS.EMPTY_CONTENT, SEND_MODE.FREE_FORM);
  if (windowOpen) return allow(SEND_MODE.FREE_FORM, ALLOW_REASONS.WITHIN_WINDOW);

  // Outside the window, free-form is never allowed.
  if (!hasInboundEver && channel === CHANNELS.WHATSAPP) {
    return block(BLOCK_REASONS.WA_INITIATE_REQUIRES_TEMPLATE, SEND_MODE.FREE_FORM);
  }
  return block(BLOCK_REASONS.OUTSIDE_WINDOW_NO_TEMPLATE, SEND_MODE.FREE_FORM);
}

function nextStatusAfterOutbound(status, senderType) {
  if (status === 'CLOSED') return 'CLOSED';
  if (senderType === SENDER_TYPES.AI) return 'AI_HANDLED';
  return 'OPEN';
}

async function loadConversation(conversationId) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { customer: { include: { identities: true } } },
  });
}

// ---- The choke point --------------------------------------------------------
export async function send({
  conversationId,
  conversation: preloaded,
  content,
  templateName,
  templateParams = [],
  senderType,
  senderAgentId = null,
  initiatedBy = null,
  now = new Date(),
}) {
  let conversation = preloaded && preloaded.customer?.identities ? preloaded : null;
  if (!conversation) {
    conversation = await loadConversation(conversationId || preloaded?.id);
  }
  if (!conversation) throw new NotFoundError('Conversation not found');

  const channel = conversation.channel;
  const customer = conversation.customer;
  const identity = customer.identities.find((i) => i.channel === channel);
  const initiator =
    initiatedBy || (senderAgentId ? `AGENT:${senderAgentId}` : senderType || 'SYSTEM');

  // Helper: persist a BLOCKED decision, emit, and return a structured result.
  const blocked = async (reason, mode = null) => {
    await prisma.outboundLog.create({
      data: {
        conversationId: conversation.id,
        customerId: customer.id,
        channel,
        decision: 'BLOCKED',
        reason,
        mode,
        templateName: templateName || null,
        initiatedBy: initiator,
      },
    });
    emitAll(EVENTS.SEND_BLOCKED, { conversationId: conversation.id, reason });
    log.warn('Outbound BLOCKED', { conversationId: conversation.id, channel, reason });
    return { ok: false, blocked: true, reason, conversationId: conversation.id };
  };

  // 1. Recipient identity must exist.
  if (!identity) return blocked(BLOCK_REASONS.NO_RECIPIENT_IDENTITY);
  const recipient = identity.externalId;

  // 2-4. Window + opt-in + template + content policy.
  const templateLookup = templateName
    ? await lookupTemplate(templateName)
    : { found: false, approved: false, template: null };
  const decision = evaluatePolicy({
    lastInboundAt: conversation.lastInboundAt,
    optedIn: customer.optedIn,
    content,
    templateName,
    templateLookup,
    channel,
    now,
  });
  if (!decision.allowed) return blocked(decision.reason, decision.mode);

  // 5. WhatsApp test-phase allowlist (only enforced when configured).
  if (channel === CHANNELS.WHATSAPP && env.whatsappTestRecipients.length > 0) {
    const digits = String(recipient).replace(/\D/g, '');
    const allowed = env.whatsappTestRecipients.some((r) => r.replace(/\D/g, '') === digits);
    if (!allowed) return blocked(BLOCK_REASONS.WA_RECIPIENT_NOT_ALLOWLISTED, decision.mode);
  }

  // 6. Instagram rolling hourly cap — atomically RESERVE a slot before sending.
  //    The reservation (an ALLOWED log row) is written under an advisory lock so
  //    concurrent sends can't all pass on a stale count (TOCTOU-safe).
  let igReservationId = null;
  if (channel === CHANNELS.INSTAGRAM) {
    const reservation = await reserveInstagramSlot(
      { conversationId: conversation.id, customerId: customer.id, initiatedBy: initiator },
      now,
    );
    if (!reservation.ok) return blocked(BLOCK_REASONS.IG_RATE_LIMIT, decision.mode);
    igReservationId = reservation.id;
  }

  // 7. Perform the actual send (real Graph API call or dry-run).
  const sender = getChannelSender(channel);
  let result;
  try {
    result =
      decision.mode === SEND_MODE.TEMPLATE
        ? await sender.sendTemplate(recipient, templateLookup.template, templateParams)
        : await sender.sendFreeForm(recipient, content);
  } catch (err) {
    log.error('Channel send failed', { channel, error: err.message });
    // Free the IG slot so a failed send doesn't consume cap headroom.
    if (igReservationId) await releaseReservation(igReservationId, BLOCK_REASONS.CHANNEL_SEND_ERROR);
    await blocked(BLOCK_REASONS.CHANNEL_SEND_ERROR, decision.mode);
    return {
      ok: false,
      blocked: true,
      reason: BLOCK_REASONS.CHANNEL_SEND_ERROR,
      error: err.message,
      conversationId: conversation.id,
    };
  }

  const storedContent =
    decision.mode === SEND_MODE.TEMPLATE
      ? result.renderedBody || renderTemplateBody(templateLookup.template, templateParams)
      : content;

  // Persist message + conversation update atomically.
  const wasFlagged = conversation.status === 'FLAGGED';
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType,
        senderAgentId: senderType === SENDER_TYPES.AGENT ? senderAgentId : null,
        direction: 'OUTBOUND',
        channel,
        content: storedContent,
        externalMessageId: result.externalMessageId,
        status: result.dryRun ? 'dry_run' : 'sent',
        sentAt: now,
      },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        lastOutboundAt: now,
        status: nextStatusAfterOutbound(conversation.status, senderType),
        flaggedAt: null, // an outbound reply resolves a red flag
      },
    }),
  ]);

  const logData = {
    reason: decision.reason,
    mode: decision.mode,
    templateName: decision.mode === SEND_MODE.TEMPLATE ? templateName : null,
    messageId: message.id,
  };
  if (igReservationId) {
    // Finalize the pre-send reservation row (do NOT create a second log — that
    // would double-count against the IG cap).
    await prisma.outboundLog.update({ where: { id: igReservationId }, data: logData });
  } else {
    await prisma.outboundLog.create({
      data: {
        conversationId: conversation.id,
        customerId: customer.id,
        channel,
        decision: 'ALLOWED',
        initiatedBy: initiator,
        ...logData,
      },
    });
  }

  emitAll(EVENTS.MESSAGE_NEW, { conversationId: conversation.id, message });
  emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId: conversation.id });
  if (wasFlagged) emitAll(EVENTS.CONVERSATION_UNFLAGGED, { conversationId: conversation.id });

  log.info('Outbound ALLOWED', {
    conversationId: conversation.id,
    channel,
    mode: decision.mode,
    dryRun: result.dryRun,
  });

  return {
    ok: true,
    message,
    mode: decision.mode,
    dryRun: result.dryRun,
    reason: decision.reason,
    conversationId: conversation.id,
  };
}

// ---- Non-mutating preview for the UI composer -------------------------------
export async function previewPolicy({ conversationId, content, templateName }) {
  const conversation = await loadConversation(conversationId);
  if (!conversation) throw new NotFoundError('Conversation not found');

  const templateLookup = templateName
    ? await lookupTemplate(templateName)
    : { found: false, approved: false, template: null };
  const decision = evaluatePolicy({
    lastInboundAt: conversation.lastInboundAt,
    optedIn: conversation.customer.optedIn,
    content,
    templateName,
    templateLookup,
    channel: conversation.channel,
  });
  const windowInfo = describeWindow(conversation.lastInboundAt);
  const rate =
    conversation.channel === CHANNELS.INSTAGRAM ? await instagramHourlyUsage() : null;

  return {
    decision,
    window: windowInfo,
    rate,
    optedIn: conversation.customer.optedIn,
    dryRun: getChannelSender(conversation.channel).isDryRun(),
  };
}
