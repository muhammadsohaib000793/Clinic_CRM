// Customer (patient) profiles: list, full history, and profile updates.
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';

export async function listCustomers({ search, limit = 50, offset = 0 } = {}) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
  const take = Math.min(Number(limit) || 50, 200);
  const skip = Math.max(Number(offset) || 0, 0);
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        identities: true,
        _count: { select: { conversations: true, appointments: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);
  return { customers, total };
}

export async function getCustomer(id) {
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      identities: true,
      conversations: {
        orderBy: { lastMessageAt: 'desc' },
        include: { messages: { orderBy: { sentAt: 'asc' } } },
      },
      appointments: {
        orderBy: { scheduledAt: 'desc' },
        include: { doctor: { select: { id: true, name: true, specialty: true } } },
      },
    },
  });
  if (!c) throw new NotFoundError('Customer not found');
  return c;
}

export async function deleteCustomer(id) {
  try {
    await prisma.customer.delete({ where: { id } }); // cascades conversations, messages, appts, identities
    return { ok: true, id };
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Customer not found');
    throw e;
  }
}

export async function updateCustomer(id, { name, notes, optedIn, contactInfo }) {
  const data = {};
  if (name !== undefined) data.name = name;
  if (notes !== undefined) data.notes = notes;
  if (contactInfo !== undefined) data.contactInfo = contactInfo;
  if (optedIn !== undefined) {
    data.optedIn = !!optedIn;
    data.optInAt = optedIn ? new Date() : null;
  }
  const c = await prisma.customer.update({ where: { id }, data });
  return c;
}
