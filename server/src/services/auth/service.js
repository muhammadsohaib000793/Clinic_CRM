import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { AuthError } from '../../lib/errors.js';

export function publicAgent(a) {
  return { id: a.id, name: a.name, email: a.email, role: a.role, status: a.status };
}

export function signToken(agent) {
  return jwt.sign(
    { sub: agent.id, role: agent.role, name: agent.name, email: agent.email },
    env.jwtSecret,
    { expiresIn: '12h' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

export async function login(email, password) {
  const agent = await prisma.agent.findUnique({ where: { email: (email || '').toLowerCase() } });
  if (!agent) throw new AuthError('Invalid email or password');
  const ok = await bcrypt.compare(password || '', agent.passwordHash);
  if (!ok) throw new AuthError('Invalid email or password');
  return { token: signToken(agent), agent: publicAgent(agent) };
}

export async function getAgentById(id) {
  const a = await prisma.agent.findUnique({ where: { id } });
  return a ? publicAgent(a) : null;
}
