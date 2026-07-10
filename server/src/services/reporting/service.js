// Reporting: message volume, response times, bookings, agent status (§4, §7).
import { prisma } from '../../db/prisma.js';

function range(from, to) {
  const start = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const end = to ? new Date(to) : new Date();
  return { start, end };
}

// Average first-response time: time from a customer inbound to the next outbound
// reply in the same conversation. Internal system notes are excluded.
async function averageResponseTime(start, end) {
  const msgs = await prisma.message.findMany({
    where: { sentAt: { gte: start, lte: end }, NOT: { status: 'internal' } },
    orderBy: [{ conversationId: 'asc' }, { sentAt: 'asc' }],
    select: { conversationId: true, direction: true, sentAt: true },
  });

  let totalMs = 0;
  let pairs = 0;
  let currentConv = null;
  let pendingInboundAt = null;
  for (const m of msgs) {
    if (m.conversationId !== currentConv) {
      currentConv = m.conversationId;
      pendingInboundAt = null;
    }
    if (m.direction === 'INBOUND') {
      if (pendingInboundAt === null) pendingInboundAt = m.sentAt;
    } else if (pendingInboundAt !== null) {
      totalMs += new Date(m.sentAt).getTime() - new Date(pendingInboundAt).getTime();
      pairs += 1;
      pendingInboundAt = null;
    }
  }
  return {
    avgMs: pairs ? Math.round(totalMs / pairs) : null,
    avgMinutes: pairs ? Number((totalMs / pairs / 60000).toFixed(1)) : null,
    sampled: pairs,
  };
}

export async function overview({ from, to } = {}) {
  const { start, end } = range(from, to);
  const [
    total,
    inbound,
    outbound,
    byChannel,
    convByStatus,
    apptTotal,
    apptByStatus,
    flaggedNow,
    agents,
  ] = await Promise.all([
    prisma.message.count({ where: { sentAt: { gte: start, lte: end }, NOT: { status: 'internal' } } }),
    prisma.message.count({ where: { direction: 'INBOUND', sentAt: { gte: start, lte: end } } }),
    prisma.message.count({
      where: { direction: 'OUTBOUND', sentAt: { gte: start, lte: end }, NOT: { status: 'internal' } },
    }),
    prisma.message.groupBy({
      by: ['channel'],
      _count: true,
      where: { sentAt: { gte: start, lte: end }, NOT: { status: 'internal' } },
    }),
    prisma.conversation.groupBy({ by: ['status'], _count: true }),
    prisma.appointment.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.appointment.groupBy({
      by: ['status'],
      _count: true,
      where: { createdAt: { gte: start, lte: end } },
    }),
    prisma.conversation.count({ where: { status: 'FLAGGED' } }),
    prisma.agent.findMany({ select: { id: true, name: true, status: true, role: true } }),
  ]);

  const responseTime = await averageResponseTime(start, end);

  return {
    range: { from: start, to: end },
    messages: {
      total,
      inbound,
      outbound,
      byChannel: byChannel.map((b) => ({ channel: b.channel, count: b._count })),
    },
    conversations: {
      byStatus: convByStatus.map((s) => ({ status: s.status, count: s._count })),
      flaggedNow,
    },
    appointments: {
      total: apptTotal,
      byStatus: apptByStatus.map((s) => ({ status: s.status, count: s._count })),
    },
    responseTime,
    agents,
  };
}

export async function messageVolumeSeries({ from, to } = {}) {
  const { start, end } = range(from, to);
  const msgs = await prisma.message.findMany({
    where: { sentAt: { gte: start, lte: end }, NOT: { status: 'internal' } },
    select: { sentAt: true, direction: true },
  });
  const byDay = {};
  for (const m of msgs) {
    const d = new Date(m.sentAt).toISOString().slice(0, 10);
    byDay[d] = byDay[d] || { inbound: 0, outbound: 0 };
    byDay[d][m.direction.toLowerCase()] += 1;
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v, total: v.inbound + v.outbound }));
}
