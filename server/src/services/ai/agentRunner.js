// AI auto-responder. Fires ONLY when every agent is offline (doc §4), replies to
// the customer's latest turn, and routes the reply through sendGuard so §9A
// (24h window, opt-in, IG cap) is enforced identically to a human send.
import { prisma } from '../../db/prisma.js';
import { send } from '../messaging/sendGuard.js';
import { generateReply } from './index.js';
import { buildSystemPrompt } from './prompt.js';
import { attemptAiBooking, bookingReply } from './booking.js';
import { cancelAppointment } from '../appointments/service.js';
import { logAudit } from '../audit/service.js';
import { emitAll } from '../../realtime/emitter.js';
import { EVENTS } from '../../realtime/events.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ai-runner');
const inFlight = new Set(); // per-conversation lock to prevent double replies

export async function anyAgentsOnline() {
  const count = await prisma.agent.count({ where: { status: 'ONLINE' } });
  return count > 0;
}

export async function maybeAutoRespond(conversationId) {
  if (inFlight.has(conversationId)) return { skipped: 'in_flight' };
  // Acquire the per-conversation lock BEFORE any await, so the has-check and the
  // add are atomic — otherwise a double-text (two overlapping calls) could each
  // pass the check and double-reply / double-book.
  inFlight.add(conversationId);
  try {
    // Doc §4: AI only covers when ALL agents are offline.
    if (await anyAgentsOnline()) return { skipped: 'agents_online' };
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
        messages: { orderBy: { sentAt: 'desc' }, take: 20 },
      },
    });
    if (!conversation) return { skipped: 'not_found' };
    if (conversation.status === 'CLOSED') return { skipped: 'closed' };

    const ordered = [...conversation.messages].reverse();
    const last = ordered[ordered.length - 1];
    // Reply only when the customer spoke last (prevents AI talking to itself).
    if (!last || last.senderType !== 'CUSTOMER') return { skipped: 'not_customer_turn' };

    const history = ordered.map((m) => ({
      role: m.senderType === 'CUSTOMER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // 1) Try to ACT on a booking request first — deterministic and validated
    //    (the LLM never books directly, so it can't hallucinate an appointment).
    let replyText = null;
    let provider = 'booking';
    let booking = null;
    try {
      booking = await attemptAiBooking({
        conversationId,
        customerId: conversation.customer.id,
        text: last.content,
      });
      if (booking.status !== 'no_intent') {
        replyText = bookingReply({ result: booking, customerName: conversation.customer.name });
      }
    } catch (e) {
      log.error('AI booking attempt failed', { conversationId, error: e.message });
    }

    // 2) Otherwise, generate a normal conversational reply.
    if (!replyText) {
      const gen = await generateReply({
        systemPrompt: buildSystemPrompt({ conversation }),
        history,
        latestInbound: last.content,
        customerName: conversation.customer.name,
      });
      replyText = gen.text;
      provider = gen.provider;
    }

    // The guard enforces §9A. Outside the 24h window it blocks the free-form
    // reply and we deliberately DO NOT auto-initiate a template.
    const result = await send({ conversationId, content: replyText, senderType: 'AI', initiatedBy: 'AI' });

    // Reconcile any booking with whether its confirmation could actually be sent.
    if (booking?.status === 'booked') {
      if (result.ok) {
        await logAudit({
          action: 'BOOK_APPOINTMENT',
          agentName: 'AI agent',
          customerId: conversation.customer.id,
          detail: `${booking.doctor.name} @ ${booking.when.toISOString()}`,
        });
      } else {
        // The patient could NOT be told (the guard blocked the confirmation), so
        // cancel — no phantom booking the patient never heard about — and audit it.
        try {
          await cancelAppointment(booking.appointment.id);
        } catch (e) {
          log.error('Failed to revert AI booking after blocked confirmation', { conversationId, error: e.message });
        }
        await logAudit({
          action: 'BOOK_APPOINTMENT_REVERTED',
          agentName: 'AI agent',
          customerId: conversation.customer.id,
          detail: `confirmation blocked (${result.reason}); ${booking.doctor.name} @ ${booking.when.toISOString()}`,
        });
      }
    }

    if (result.ok) {
      emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId });
      log.info('AI replied', { conversationId, provider, booked: booking?.status === 'booked', dryRun: result.dryRun });
    } else {
      log.warn('AI reply blocked by guard (left for human)', { conversationId, reason: result.reason });
    }
    return { ...result, provider, booking: booking?.status };
  } finally {
    inFlight.delete(conversationId);
  }
}
