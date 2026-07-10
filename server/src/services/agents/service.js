// Agent account management (Admin-only per §4 roles matrix).
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma.js';
import { publicAgent } from '../auth/service.js';
import { ValidationError, NotFoundError } from '../../lib/errors.js';

export async function listAgents() {
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'asc' } });
  return agents.map(publicAgent);
}

export async function createAgent({ name, email, password, role = 'AGENT' }) {
  if (!name || !email || !password) throw new ValidationError('name, email and password are required');
  if (!['ADMIN', 'AGENT'].includes(role)) throw new ValidationError('role must be ADMIN or AGENT');
  const passwordHash = await bcrypt.hash(password, 10);
  const agent = await prisma.agent.create({
    data: { name, email: email.toLowerCase(), passwordHash, role },
  });
  return publicAgent(agent);
}

export async function updateAgent(id, { name, role, password }) {
  const data = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) {
    if (!['ADMIN', 'AGENT'].includes(role)) throw new ValidationError('role must be ADMIN or AGENT');
    data.role = role;
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  try {
    const agent = await prisma.agent.update({ where: { id }, data });
    return publicAgent(agent);
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Agent not found');
    throw e;
  }
}

export async function deleteAgent(id) {
  try {
    await prisma.agent.delete({ where: { id } });
    return { ok: true };
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Agent not found');
    throw e;
  }
}
