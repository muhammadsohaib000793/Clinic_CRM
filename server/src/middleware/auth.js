import { verifyToken } from '../services/auth/service.js';
import { prisma } from '../db/prisma.js';
import { AuthError } from '../lib/errors.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AuthError('Missing authorization token');

    const payload = verifyToken(token);
    const agent = await prisma.agent.findUnique({ where: { id: payload.sub } });
    if (!agent) throw new AuthError('Account not found');

    req.agent = {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      status: agent.status,
    };
    next();
  } catch (err) {
    next(err instanceof AuthError ? err : new AuthError('Invalid or expired token'));
  }
}
