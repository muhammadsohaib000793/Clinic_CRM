// Socket.IO server: JWT-authenticated handshake, agent presence (ONLINE/OFFLINE
// — the signal the AI runner uses), and per-conversation rooms for live updates.
import { Server } from 'socket.io';
import { verifyToken } from '../services/auth/service.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { bindIo, emitAll } from './emitter.js';
import { EVENTS } from './events.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('socket');

async function setAgentStatus(agentId, status) {
  try {
    const agent = await prisma.agent.update({
      where: { id: agentId },
      data: { status, lastSeenAt: new Date() },
    });
    emitAll(EVENTS.AGENT_STATUS, { agentId, status, name: agent.name });
  } catch {
    /* agent may have been removed — ignore */
  }
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyToken(token);
      socket.agentId = payload.sub;
      socket.agentRole = payload.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const agentId = socket.agentId;
    socket.join('agents');
    socket.join(`agent:${agentId}`);
    await setAgentStatus(agentId, 'ONLINE');
    log.info('Agent connected', { agentId });

    socket.on('conversation:join', (id) => id && socket.join(`conversation:${id}`));
    socket.on('conversation:leave', (id) => id && socket.leave(`conversation:${id}`));

    socket.on('disconnect', async () => {
      // Mark offline only if the agent has no other live sockets (multi-tab safe).
      const remaining = await io.in(`agent:${agentId}`).fetchSockets();
      if (remaining.length === 0) await setAgentStatus(agentId, 'OFFLINE');
      log.info('Agent disconnected', { agentId, remaining: remaining.length });
    });
  });

  bindIo(io);
  return io;
}
