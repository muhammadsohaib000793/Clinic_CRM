// Red-flag engine (§4): scans every minute for OPEN conversations whose last
// message is an unanswered customer inbound older than the configured threshold,
// flags them, and emits a live alert.
import cron from 'node-cron';
import { prisma } from '../../db/prisma.js';
import { getRedflagThresholdMinutes } from '../settings/service.js';
import { emitAll } from '../../realtime/emitter.js';
import { EVENTS } from '../../realtime/events.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('redflag');

export async function scanOnce() {
  const thresholdMinutes = await getRedflagThresholdMinutes();
  const cutoff = new Date(Date.now() - thresholdMinutes * 60000);

  const candidates = await prisma.conversation.findMany({
    where: { status: 'OPEN', lastInboundAt: { not: null, lte: cutoff } },
    select: { id: true, lastInboundAt: true, lastOutboundAt: true },
  });

  const toFlag = candidates.filter(
    (c) => !c.lastOutboundAt || new Date(c.lastInboundAt) > new Date(c.lastOutboundAt),
  );

  let flagged = 0;
  for (const c of toFlag) {
    await prisma.conversation.update({
      where: { id: c.id },
      data: { status: 'FLAGGED', flaggedAt: new Date() },
    });
    emitAll(EVENTS.CONVERSATION_FLAGGED, { conversationId: c.id });
    emitAll(EVENTS.CONVERSATION_UPDATED, { conversationId: c.id });
    flagged += 1;
  }
  if (flagged) log.warn(`Red-flagged ${flagged} unattended conversation(s)`, { thresholdMinutes });
  return { scanned: candidates.length, flagged, thresholdMinutes };
}

export function startRedflagScanner() {
  const task = cron.schedule('* * * * *', () => {
    scanOnce().catch((err) => log.error('Scan failed', { error: err.message }));
  });
  log.info('Red-flag scanner started (runs every 60s)');
  // Run once shortly after boot so demo data flags without waiting a minute.
  setTimeout(() => scanOnce().catch(() => {}), 3000);
  return task;
}
