// PHI access / action audit trail (compliance baseline, §5 & §13).
import { prisma } from '../../db/prisma.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('audit');

export async function logAudit({ agentId = null, agentName = null, action, customerId = null, detail = null }) {
  try {
    await prisma.auditLog.create({ data: { agentId, agentName, action, customerId, detail } });
  } catch (e) {
    // Auditing must never break the request it records.
    log.warn('Audit write failed', { action, error: e.message });
  }
}

export async function listAudit({ limit = 100, customerId } = {}) {
  const entries = await prisma.auditLog.findMany({
    where: customerId ? { customerId } : {},
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 100, 500),
  });
  const ids = [...new Set(entries.map((e) => e.customerId).filter(Boolean))];
  const customers = ids.length
    ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  return entries.map((e) => ({
    ...e,
    customerName: e.customerId ? nameById[e.customerId] || '(removed)' : null,
  }));
}
