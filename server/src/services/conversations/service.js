// Conversation/inbox service: listing, atomic claim/assign (prevents two agents
// replying to the same conversation), reply (routed through sendGuard), and
// AI->human takeover with full-history preservation.
import { prisma } from '../../db/prisma.js';
import { send } from '../messaging/sendGuard.js';
import { describeWindow } from '../messaging/windowPolicy.js';
import { emitAll } from '../../realtime/emitter.js';
import { EVENTS } from '../../realtime/events.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../lib/errors.js';

export function isUnanswered(c) {
  if (!c.lastInboundAt) return false;
  if (!c.lastOutboundAt) return true;
  return new Date(c.lastInboundAt).getTime() > new Date(c.lastOutboundAt).getTime();
}

function decorate(c) {
  if (!c) return c;
  return { ...c, window: describeWindow(c.lastInboundAt), unanswered: isUnanswered(c) };
}

async function getFull(id) {
  return prisma.conversation.findUnique({
    where: { id },
    include: {
      customer: { include: { identities: true } },
      assignedAgent: { select: { id: true, name: true, role: true, status: true } },
      messages: { orderBy: { sentAt: 'asc' } },
      appointments: { include: { doctor: { select: { id: true, name: true } } }, orderBy: { scheduledAt: 'desc' } },
    },
  });
}

export async function listConversations({ channel, status, assigned, flagged, agentId, search } = {}) {
  const where = {};
  if (channel) where.channel = channel;
  if (status) where.status = status;
  if (flagged === true || flagged === 'true') where.status = 'FLAGGED';
  if (assigned === 'me') where.assignedAgentId = agentId;
  else if (assigned === 'unassigned') where.assignedAgentId = null;
  if (search) where.customer = { name: { contains: search, mode: 'insensitive' } };

  const convs = await prisma.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      customer: { select: { id: true, name: true, optedIn: true } },
      assignedAgent: { select: { id: true, name: true } },
      messages: { orderBy: { sentAt: 'desc' }, take: 1 },
    },
    take: 200,
  });

  return convs.map((c) => {
    const { messages, ...rest } = c;
    return { ...decorate(rest), lastMessage: messages[0] || null };
  });
}

export async function getConversation(id) {
  const conv = await getFull(id);
  if (!conv) throw new NotFoundError('Conversation not found');
  return decorate(conv);
}

// Atomic claim — only succeeds if currently unassigned (or already mine).
export async function claimConversation(id, agentId) {
  const existing = await prisma.conversation.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Conversation not found');
  if (existing.assignedAgentId === agentId) return getConversation(id);

  const result = await prisma.conversation.updateMany({
    where: { id, assignedAgentId: null },
    data: { assignedAgentId: agentId },
  });
  if (result.count === 0) throw new ConflictError('Conversation already claimed by another agent');

  emitAll(EVENTS.CONVERSATION_CLAIMED, { conversationId: id, agentId });
  emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId: id });
  return getConversation(id);
}

// Admin reassignment (or unassign when targetAgentId is null).
export async function assignConversation(id, targetAgentId) {
  const existing = await prisma.conversation.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Conversation not found');
  if (targetAgentId) {
    const agent = await prisma.agent.findUnique({ where: { id: targetAgentId } });
    if (!agent) throw new NotFoundError('Target agent not found');
  }
  await prisma.conversation.update({ where: { id }, data: { assignedAgentId: targetAgentId } });
  emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId: id });
  return getConversation(id);
}

// Reply — enforces single-replier, then routes through sendGuard (§9A).
export async function replyToConversation(id, agent, { content, templateName, templateParams }) {
  const conv = await prisma.conversation.findUnique({ where: { id } });
  if (!conv) throw new NotFoundError('Conversation not found');

  if (!conv.assignedAgentId) {
    const claimed = await prisma.conversation.updateMany({
      where: { id, assignedAgentId: null },
      data: { assignedAgentId: agent.id },
    });
    if (claimed.count === 0) {
      const fresh = await prisma.conversation.findUnique({ where: { id } });
      if (fresh.assignedAgentId !== agent.id) {
        throw new ConflictError('Conversation was just claimed by another agent');
      }
    } else {
      emitAll(EVENTS.CONVERSATION_CLAIMED, { conversationId: id, agentId: agent.id });
    }
  } else if (conv.assignedAgentId !== agent.id && agent.role !== 'ADMIN') {
    throw new ForbiddenError('Conversation is assigned to another agent — take over first.');
  }

  return send({
    conversationId: id,
    content,
    templateName,
    templateParams,
    senderType: 'AGENT',
    senderAgentId: agent.id,
  });
}

// AI -> human takeover. Full history is inherently preserved (all messages are
// stored); we assign the human, clear AI/flag state, and drop an internal marker.
export async function takeoverConversation(id, agent) {
  const conv = await prisma.conversation.findUnique({ where: { id } });
  if (!conv) throw new NotFoundError('Conversation not found');

  await prisma.conversation.update({
    where: { id },
    data: {
      assignedAgentId: agent.id,
      status: conv.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
      flaggedAt: null,
    },
  });

  // Internal handoff marker — NOT sent to the customer (never touches Meta).
  const note = await prisma.message.create({
    data: {
      conversationId: id,
      senderType: 'SYSTEM',
      direction: 'OUTBOUND',
      channel: conv.channel,
      content: `${agent.name} took over from the AI agent. Full chat history preserved.`,
      status: 'internal',
      sentAt: new Date(),
    },
  });

  emitAll(EVENTS.CONVERSATION_TAKEOVER, { conversationId: id, agentId: agent.id, agentName: agent.name });
  emitAll(EVENTS.MESSAGE_NEW, { conversationId: id, message: note });
  emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId: id });
  return getConversation(id);
}

export async function setStatus(id, status) {
  const conv = await prisma.conversation.findUnique({ where: { id } });
  if (!conv) throw new NotFoundError('Conversation not found');
  await prisma.conversation.update({
    where: { id },
    data: { status, flaggedAt: status === 'FLAGGED' ? new Date() : null },
  });
  emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId: id });
  return getConversation(id);
}
