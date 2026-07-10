// Per-channel automated-send rate limiting (§9A).
// Instagram: ~200 automated DMs / hour / account (rolling). We keep a margin
// (INSTAGRAM_HOURLY_DM_CAP, default 180) and count ALLOWED outbound logs in the
// trailing hour — a persistent rolling window that survives restarts.
import { prisma } from '../../db/prisma.js';
import {
  INSTAGRAM_HOURLY_DM_CAP,
  ONE_HOUR_MS,
  CHANNELS,
  SEND_DECISION,
} from '../../config/constants.js';

export async function instagramHourlyUsage(now = new Date()) {
  const since = new Date(now.getTime() - ONE_HOUR_MS);
  const used = await prisma.outboundLog.count({
    where: {
      channel: CHANNELS.INSTAGRAM,
      decision: SEND_DECISION.ALLOWED,
      createdAt: { gte: since },
    },
  });
  return {
    used,
    cap: INSTAGRAM_HOURLY_DM_CAP,
    remaining: Math.max(0, INSTAGRAM_HOURLY_DM_CAP - used),
  };
}

// Returns { ok, used, cap, remaining } — ok=false means the IG cap is reached.
// NOTE: this is a non-atomic read for previews/status only. To actually gate a
// send, use reserveInstagramSlot() which is race-safe.
export async function canSendInstagram(now = new Date()) {
  const usage = await instagramHourlyUsage(now);
  return { ok: usage.remaining > 0, ...usage };
}

// Arbitrary constant key for the Postgres transaction advisory lock that
// serializes Instagram slot reservations.
const IG_ADVISORY_LOCK_KEY = 918273465;

// Atomically reserve one Instagram send slot (§9A rolling hourly cap).
// A transaction-scoped advisory lock serializes the count-and-reserve so
// concurrent sends cannot all observe the same stale count (fixes the TOCTOU
// race). The reservation is an ALLOWED OutboundLog row written BEFORE the send;
// count() includes it immediately. Returns { ok, id?, used, cap }.
export async function reserveInstagramSlot({ conversationId, customerId, initiatedBy } = {}, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    // Held until this transaction commits/rolls back; all queries below run on
    // the same connection, so the lock is effective and auto-released.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IG_ADVISORY_LOCK_KEY})`;
    const since = new Date(now.getTime() - ONE_HOUR_MS);
    const used = await tx.outboundLog.count({
      where: { channel: CHANNELS.INSTAGRAM, decision: SEND_DECISION.ALLOWED, createdAt: { gte: since } },
    });
    if (used >= INSTAGRAM_HOURLY_DM_CAP) {
      return { ok: false, used, cap: INSTAGRAM_HOURLY_DM_CAP };
    }
    const row = await tx.outboundLog.create({
      data: {
        conversationId: conversationId || null,
        customerId: customerId || null,
        channel: CHANNELS.INSTAGRAM,
        decision: SEND_DECISION.ALLOWED,
        reason: 'allowed:ig_slot_reserved',
        initiatedBy: initiatedBy || null,
      },
    });
    return { ok: true, id: row.id, used: used + 1, cap: INSTAGRAM_HOURLY_DM_CAP };
  });
}

// Free a reservation whose send ultimately failed — flip it to BLOCKED so it no
// longer counts against the hourly cap.
export async function releaseReservation(id, reason = 'blocked:channel_send_error') {
  if (!id) return;
  await prisma.outboundLog
    .update({ where: { id }, data: { decision: SEND_DECISION.BLOCKED, reason } })
    .catch(() => {});
}
