// AI auto-responder. Fires ONLY when every agent is offline (doc §4), replies to
// the customer's latest turn, and routes the reply through sendGuard so §9A
// (24h window, opt-in, IG cap) is enforced identically to a human send.
import { prisma } from '../../db/prisma.js';
import { send } from '../messaging/sendGuard.js';
import { generateReply } from './index.js';
import { buildSystemPrompt } from './prompt.js';
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

  // Doc §4: AI only covers when ALL agents are offline.
  if (await anyAgentsOnline()) return { skipped: 'agents_online' };

  inFlight.add(conversationId);
  try {
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
    const systemPrompt = buildSystemPrompt({ conversation });

    const { text, provider } = await generateReply({
      systemPrompt,
      history,
      latestInbound: last.content,
      customerName: conversation.customer.name,
    });

    // The guard enforces §9A. Outside the 24h window the guard blocks the
    // free-form reply and we deliberately DO NOT auto-initiate a template.
    const result = await send({
      conversationId,
      content: text,
      senderType: 'AI',
      initiatedBy: 'AI',
    });

    if (result.ok) {
      emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId });
      log.info('AI replied', { conversationId, provider, dryRun: result.dryRun });
    } else {
      log.warn('AI reply blocked by guard (left for human)', {
        conversationId,
        reason: result.reason,
      });
    }
    return { ...result, provider };
  } finally {
    inFlight.delete(conversationId);
  }
}
