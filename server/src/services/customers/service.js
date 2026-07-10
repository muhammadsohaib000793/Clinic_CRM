// Customer (patient) profiles: list, full history, and profile updates.
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';

export async function listCustomers({ search } = {}) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
  return prisma.customer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      identities: true,
      _count: { select: { conversations: true, appointments: true } },
    },
  });
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
