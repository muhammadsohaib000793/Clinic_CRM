// =============================================================================
//  Marketing — email/WhatsApp campaigns, loyalty points, gift cards, surveys.
// -----------------------------------------------------------------------------
//  §9A COMPLIANCE — NON-NEGOTIABLE:
//   * A campaign is MARKETING, i.e. business-initiated. WhatsApp campaigns are
//     therefore ALWAYS sent through sendGuard.send() with an APPROVED template
//     name. This module never calls a channel sender directly and never sends
//     free-form campaign text on WhatsApp.
//   * Every campaign — email or WhatsApp — targets ONLY customers with
//     optedIn === true. The audience filter's optedInOnly flag is forced to true
//     at send time so a saved filter can never widen the audience, and each
//     recipient is re-checked immediately before its send.
//   * Every marketing email carries an unsubscribe line in its body.
//   * A blocked send is an expected outcome (recorded SKIPPED with the policy
//     reason), never an exception that aborts the run.
// =============================================================================
import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors.js';
import { num, money } from '../../lib/money.js';
import { sendEmail } from '../notify/email.js';
import * as sendGuard from '../messaging/sendGuard.js';
import { getSetting } from '../settings/service.js';
import { emitAll } from '../../realtime/emitter.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('marketing');

const CAMPAIGN_CHANNELS = ['EMAIL', 'WHATSAPP'];
const EDITABLE_STATUSES = ['DRAFT', 'SCHEDULED'];
const GIFT_CARD_STATUSES = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED'];

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function clinicName() {
  return (await getSetting('clinic.name', null)) || 'our clinic';
}

// ============================== CAMPAIGNS ====================================

// A saved filter is untrusted input: normalize it and force the opt-in gate on.
function normalizeFilter(raw = {}) {
  const since = raw.createdSince ? new Date(raw.createdSince) : null;
  return {
    optedInOnly: raw.optedInOnly === undefined ? true : !!raw.optedInOnly,
    hasEmail: !!raw.hasEmail,
    hasPhone: !!raw.hasPhone,
    createdSince: since && !Number.isNaN(since.getTime()) ? since.toISOString() : null,
  };
}

function audienceWhere(filter) {
  const and = [];
  if (filter.optedInOnly) and.push({ optedIn: true });
  if (filter.hasEmail) and.push({ email: { not: null } }, { email: { not: '' } });
  if (filter.hasPhone) and.push({ phone: { not: null } }, { phone: { not: '' } });
  if (filter.createdSince) and.push({ createdAt: { gte: new Date(filter.createdSince) } });
  return and.length ? { AND: and } : {};
}

export async function audienceFor(filter = {}) {
  const normalized = normalizeFilter(filter);
  return prisma.customer.findMany({
    where: audienceWhere(normalized),
    select: { id: true, name: true, email: true, phone: true, optedIn: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function previewAudience(filter = {}) {
  const normalized = normalizeFilter(filter);
  const where = audienceWhere(normalized);
  const [count, sample] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, select: { name: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  return { count, sample: sample.map((c) => c.name), filter: normalized };
}

function shapeCampaign(c, counts = null) {
  return {
    id: c.id,
    name: c.name,
    channel: c.channel,
    subject: c.subject,
    body: c.body,
    templateName: c.templateName,
    status: c.status,
    scheduledAt: c.scheduledAt,
    sentAt: c.sentAt,
    audienceFilter: normalizeFilter(c.audienceFilter || {}),
    recipientCount: counts ? counts.total : c._count?.recipients ?? 0,
    ...(counts ? { counts } : {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function listCampaigns() {
  const rows = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { recipients: true } } },
  });
  return rows.map((c) => shapeCampaign(c));
}

export async function getCampaign(id) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError('Campaign not found');
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId: id },
    _count: { _all: true },
  });
  const counts = { PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0, total: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.total += g._count._all;
  }
  return shapeCampaign(campaign, counts);
}

function validateCampaignShape({ channel, subject, templateName }) {
  if (!CAMPAIGN_CHANNELS.includes(channel)) {
    throw new ValidationError(`Campaign channel must be one of ${CAMPAIGN_CHANNELS.join(', ')}`);
  }
  if (channel === 'EMAIL' && !String(subject || '').trim()) {
    throw new ValidationError('Email campaigns need a subject line');
  }
  // §9A: a WhatsApp campaign is business-initiated — a template is mandatory.
  if (channel === 'WHATSAPP' && !String(templateName || '').trim()) {
    throw new ValidationError('WhatsApp campaigns require an approved template name (§9A)');
  }
}

export async function createCampaign(data = {}) {
  const name = String(data.name || '').trim();
  const body = String(data.body || '').trim();
  if (!name) throw new ValidationError('Campaign name is required');
  if (!body) throw new ValidationError('Campaign body is required');
  const channel = data.channel || 'EMAIL';
  validateCampaignShape({ channel, subject: data.subject, templateName: data.templateName });

  const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new ValidationError('scheduledAt is not a valid date');

  const campaign = await prisma.campaign.create({
    data: {
      name,
      channel,
      subject: data.subject ? String(data.subject).trim() : null,
      body,
      templateName: data.templateName ? String(data.templateName).trim() : null,
      status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
      scheduledAt,
      audienceFilter: normalizeFilter(data.audienceFilter || {}),
      createdByAgentId: data.createdByAgentId || null,
    },
  });
  return shapeCampaign(campaign);
}

export async function updateCampaign(id, data = {}) {
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Campaign not found');
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw new ConflictError(`A ${existing.status} campaign can no longer be edited`);
  }

  const next = {
    channel: data.channel !== undefined ? data.channel : existing.channel,
    subject: data.subject !== undefined ? data.subject : existing.subject,
    templateName: data.templateName !== undefined ? data.templateName : existing.templateName,
  };
  validateCampaignShape(next);

  const patch = { channel: next.channel };
  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw new ValidationError('Campaign name is required');
    patch.name = name;
  }
  if (data.body !== undefined) {
    const body = String(data.body).trim();
    if (!body) throw new ValidationError('Campaign body is required');
    patch.body = body;
  }
  if (data.subject !== undefined) patch.subject = data.subject ? String(data.subject).trim() : null;
  if (data.templateName !== undefined) {
    patch.templateName = data.templateName ? String(data.templateName).trim() : null;
  }
  if (data.audienceFilter !== undefined) patch.audienceFilter = normalizeFilter(data.audienceFilter || {});
  if (data.scheduledAt !== undefined) {
    const when = data.scheduledAt ? new Date(data.scheduledAt) : null;
    if (when && Number.isNaN(when.getTime())) throw new ValidationError('scheduledAt is not a valid date');
    patch.scheduledAt = when;
    patch.status = when ? 'SCHEDULED' : 'DRAFT';
  }

  const campaign = await prisma.campaign.update({ where: { id }, data: patch });
  return shapeCampaign(campaign);
}

export async function deleteCampaign(id) {
  try {
    await prisma.campaign.delete({ where: { id } }); // cascades recipients
    return { ok: true, id };
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Campaign not found');
    throw e;
  }
}

function campaignHtml({ body, clinic }) {
  const paragraphs = String(body)
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  // The unsubscribe line is mandatory on every marketing email.
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">
  ${paragraphs}
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:20px 0">
  <p style="color:#6b7280;font-size:12px">
    You are receiving this because you opted in to updates from ${esc(clinic)}.
    To unsubscribe, reply to this email with "UNSUBSCRIBE" and we will remove you immediately.
  </p>
</div>`;
}

// Sends one recipient. NEVER throws — returns { status, error }.
async function sendToRecipient({ campaign, customer, clinic }) {
  // Defence in depth: re-check the opt-in gate for this exact customer.
  if (!customer.optedIn) return { status: 'SKIPPED', error: 'Customer has not opted in (§9A)' };

  try {
    if (campaign.channel === 'EMAIL') {
      if (!customer.email || !customer.email.trim()) {
        return { status: 'SKIPPED', error: 'Customer has no email address' };
      }
      const result = await sendEmail({
        to: customer.email.trim(),
        subject: campaign.subject || campaign.name,
        html: campaignHtml({ body: campaign.body, clinic }),
      });
      if (result.ok) return { status: 'SENT', error: null };
      return { status: 'FAILED', error: result.error || 'Email provider error' };
    }

    // WHATSAPP — §9A: template-only, through the sendGuard choke point.
    const conversation = await prisma.conversation.findFirst({
      where: { customerId: customer.id, channel: 'WHATSAPP' },
      select: { id: true },
    });
    if (!conversation) return { status: 'SKIPPED', error: 'No WhatsApp conversation on file' };

    const result = await sendGuard.send({
      conversationId: conversation.id,
      templateName: campaign.templateName,
      templateParams: [customer.name, clinic],
      senderType: 'SYSTEM',
      initiatedBy: `SYSTEM:CAMPAIGN:${campaign.id}`,
    });
    if (result.ok) return { status: 'SENT', error: null };
    // A policy block is an expected, audited outcome — not a failure.
    return { status: 'SKIPPED', error: result.reason || 'Blocked by messaging policy' };
  } catch (err) {
    return { status: 'FAILED', error: err.message };
  }
}

export async function sendCampaign(id) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError('Campaign not found');
  if (campaign.status === 'SENDING') throw new ConflictError('This campaign is already being sent');
  if (campaign.status === 'SENT') throw new ConflictError('This campaign has already been sent');
  validateCampaignShape(campaign);

  // §9A: opt-in is forced on regardless of what the saved filter says.
  const filter = { ...normalizeFilter(campaign.audienceFilter || {}), optedInOnly: true };
  if (campaign.channel === 'EMAIL') filter.hasEmail = true;
  const audience = await audienceFor(filter);
  if (audience.length === 0) throw new ValidationError('No opted-in customers match this audience');

  await prisma.campaignRecipient.createMany({
    data: audience.map((c) => ({ campaignId: campaign.id, customerId: c.id })),
    skipDuplicates: true,
  });
  await prisma.campaign.update({ where: { id }, data: { status: 'SENDING' } });
  emitAll('campaign:sending', { campaignId: campaign.id, audience: audience.length });

  const clinic = await clinicName();
  const counters = { sent: 0, failed: 0, skipped: 0 };

  // Sequential so one slow/failing recipient can never stall or abort the rest.
  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: 'PENDING' },
    include: { customer: { select: { id: true, name: true, email: true, phone: true, optedIn: true } } },
  });

  for (const recipient of pending) {
    let outcome;
    try {
      outcome = await sendToRecipient({ campaign, customer: recipient.customer, clinic });
    } catch (err) {
      outcome = { status: 'FAILED', error: err.message };
    }
    try {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: outcome.status,
          error: outcome.error ? String(outcome.error).slice(0, 500) : null,
          sentAt: outcome.status === 'SENT' ? new Date() : null,
        },
      });
    } catch (err) {
      log.error('Could not record campaign recipient outcome', { recipientId: recipient.id, error: err.message });
    }
    if (outcome.status === 'SENT') counters.sent += 1;
    else if (outcome.status === 'FAILED') counters.failed += 1;
    else counters.skipped += 1;
  }

  await prisma.campaign.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
  log.info('Campaign sent', { campaignId: campaign.id, ...counters });
  emitAll('campaign:sent', { campaignId: campaign.id, ...counters });
  return counters;
}

// =============================== LOYALTY =====================================

// Tier thresholds are based on LIFETIME earned points, so redeeming never
// demotes a customer.
function tierFor(lifetimeEarned) {
  if (lifetimeEarned < 500) return 'BRONZE';
  if (lifetimeEarned < 1500) return 'SILVER';
  if (lifetimeEarned < 3000) return 'GOLD';
  return 'PLATINUM';
}

async function getOrCreateAccount(customerId) {
  if (!customerId) throw new ValidationError('customerId is required');
  const existing = await prisma.loyaltyAccount.findUnique({ where: { customerId } });
  if (existing) return existing;
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new NotFoundError('Customer not found');
  return prisma.loyaltyAccount.create({ data: { customerId } });
}

async function lifetimeEarned(accountId) {
  const agg = await prisma.loyaltyTransaction.aggregate({
    where: { accountId, points: { gt: 0 } },
    _sum: { points: true },
  });
  return agg._sum.points || 0;
}

// Recomputes the stored tier from lifetime earnings and returns the fresh account.
async function syncTier(accountId) {
  const earned = await lifetimeEarned(accountId);
  const tier = tierFor(earned);
  const account = await prisma.loyaltyAccount.update({ where: { id: accountId }, data: { tier } });
  return { account, lifetimeEarned: earned };
}

function shapeAccount(account, earned, customerName = null) {
  return {
    id: account.id,
    customerId: account.customerId,
    customerName,
    points: account.points,
    tier: account.tier,
    lifetimeEarned: earned,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function getLoyalty(customerId) {
  const account = await getOrCreateAccount(customerId);
  const [earned, transactions, customer] = await Promise.all([
    lifetimeEarned(account.id),
    prisma.loyaltyTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } }),
  ]);
  return {
    account: shapeAccount(account, earned, customer?.name || null),
    transactions: transactions.map((t) => ({
      id: t.id,
      points: t.points,
      reason: t.reason,
      paymentId: t.paymentId,
      createdAt: t.createdAt,
    })),
  };
}

function validatePoints(points) {
  const n = Number(points);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError('points must be a whole number greater than zero');
  return n;
}

export async function earnPoints({ customerId, points, reason, paymentId = null }) {
  const amount = validatePoints(points);
  const account = await getOrCreateAccount(customerId);
  const [transaction] = await prisma.$transaction([
    prisma.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        points: amount,
        reason: String(reason || 'Points earned').slice(0, 200),
        paymentId: paymentId || null,
      },
    }),
    prisma.loyaltyAccount.update({ where: { id: account.id }, data: { points: { increment: amount } } }),
  ]);
  const { account: fresh, lifetimeEarned: earned } = await syncTier(account.id);
  emitAll('loyalty:updated', { customerId, points: fresh.points, tier: fresh.tier });
  return { account: shapeAccount(fresh, earned), transaction };
}

export async function redeemPoints({ customerId, points, reason }) {
  const amount = validatePoints(points);
  const account = await getOrCreateAccount(customerId);
  if (account.points < amount) {
    throw new ConflictError(`Insufficient points: balance is ${account.points}, tried to redeem ${amount}`);
  }
  // The check above is only for the friendly message. The real guard is the
  // conditional decrement below — without it two concurrent redemptions would
  // both pass the check and drive the balance negative.
  const transaction = await prisma.$transaction(async (tx) => {
    const res = await tx.loyaltyAccount.updateMany({
      where: { id: account.id, points: { gte: amount } },
      data: { points: { decrement: amount } },
    });
    if (res.count === 0) throw new ConflictError('Insufficient points');
    return tx.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        points: -amount,
        reason: String(reason || 'Points redeemed').slice(0, 200),
      },
    });
  });
  const { account: fresh, lifetimeEarned: earned } = await syncTier(account.id);
  emitAll('loyalty:updated', { customerId, points: fresh.points, tier: fresh.tier });
  return { account: shapeAccount(fresh, earned), transaction };
}

export async function loyaltyLeaderboard(limit = 20) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const rows = await prisma.loyaltyAccount.findMany({
    orderBy: [{ points: 'desc' }, { updatedAt: 'desc' }],
    take,
    include: { customer: { select: { id: true, name: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    customerName: a.customer?.name || 'Unknown',
    points: a.points,
    tier: a.tier,
    updatedAt: a.updatedAt,
  }));
}

// ============================== GIFT CARDS ===================================

// Unambiguous alphabet — no O/0, I/1 — so a printed code is easy to read back.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateGiftCardCode() {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `GC-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function shapeGiftCard(g) {
  return {
    id: g.id,
    code: g.code,
    initialAmount: num(g.initialAmount),
    balance: num(g.balance),
    status: g.status,
    customerId: g.customerId,
    customerName: g.customer?.name || null,
    note: g.note,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    ...(g.transactions
      ? {
          transactions: g.transactions.map((t) => ({
            id: t.id,
            amount: num(t.amount),
            paymentId: t.paymentId,
            note: t.note,
            createdAt: t.createdAt,
          })),
        }
      : {}),
  };
}

export async function listGiftCards({ status } = {}) {
  const where = status && GIFT_CARD_STATUSES.includes(status) ? { status } : {};
  const rows = await prisma.giftCard.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, name: true } } },
  });
  return rows.map(shapeGiftCard);
}

export async function createGiftCard({ amount, customerId = null, note = null, expiresAt = null } = {}) {
  const value = money(amount);
  if (!(value > 0)) throw new ValidationError('Gift card amount must be greater than zero');

  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundError('Customer not found');
  }
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (expires && Number.isNaN(expires.getTime())) throw new ValidationError('expiresAt is not a valid date');

  // Codes are random, so a collision is vanishingly unlikely — but retry anyway.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const card = await prisma.giftCard.create({
        data: {
          code: generateGiftCardCode(),
          initialAmount: value,
          balance: value,
          customerId: customerId || null,
          note: note ? String(note).slice(0, 500) : null,
          expiresAt: expires,
        },
        include: { customer: { select: { id: true, name: true } } },
      });
      emitAll('giftcard:created', { id: card.id, code: card.code });
      return shapeGiftCard(card);
    } catch (e) {
      if (e.code !== 'P2002') throw e;
    }
  }
  throw new ConflictError('Could not generate a unique gift card code — please try again');
}

export async function getGiftCardByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw new ValidationError('Gift card code is required');
  const card = await prisma.giftCard.findUnique({
    where: { code: normalized },
    include: {
      customer: { select: { id: true, name: true } },
      transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!card) throw new NotFoundError('Gift card not found');
  return shapeGiftCard(card);
}

export async function redeemGiftCard({ code, amount, paymentId = null }) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw new ValidationError('Gift card code is required');
  const value = money(amount);
  if (!(value > 0)) throw new ValidationError('Redemption amount must be greater than zero');

  const card = await prisma.giftCard.findUnique({ where: { code: normalized } });
  if (!card) throw new NotFoundError('Gift card not found');
  if (card.status !== 'ACTIVE') throw new ConflictError(`This gift card is ${card.status.toLowerCase()}`);
  if (card.expiresAt && card.expiresAt.getTime() < Date.now()) {
    await prisma.giftCard.update({ where: { id: card.id }, data: { status: 'EXPIRED' } });
    throw new ConflictError('This gift card has expired');
  }
  const balance = num(card.balance);
  if (value > balance) throw new ConflictError(`Insufficient balance: ${balance} remaining`);

  // The read above is only for a friendly error message — it is NOT the guard.
  // Two concurrent redemptions would both pass it, so the real check is the
  // conditional, RELATIVE decrement below: `count === 0` means someone else
  // spent the balance (or cancelled the card) first.
  const { updated, transaction } = await prisma.$transaction(async (tx) => {
    const res = await tx.giftCard.updateMany({
      where: { id: card.id, status: 'ACTIVE', balance: { gte: value } },
      data: { balance: { decrement: value } },
    });
    if (res.count === 0) {
      throw new ConflictError('Insufficient balance or this gift card is no longer active');
    }
    const transaction = await tx.giftCardTransaction.create({
      data: {
        giftCardId: card.id,
        amount: -value, // negative = redeemed
        paymentId: paymentId || null,
        note: `Redeemed ${value}`,
      },
    });
    const fresh = await tx.giftCard.findUnique({ where: { id: card.id } });
    const updated =
      num(fresh.balance) <= 0
        ? await tx.giftCard.update({
            where: { id: card.id },
            data: { status: 'REDEEMED' },
            include: { customer: { select: { id: true, name: true } } },
          })
        : await tx.giftCard.findUnique({
            where: { id: card.id },
            include: { customer: { select: { id: true, name: true } } },
          });
    return { updated, transaction };
  });
  emitAll('giftcard:redeemed', { id: updated.id, code: updated.code, amount: value });
  return {
    giftCard: shapeGiftCard(updated),
    transaction: { id: transaction.id, amount: num(transaction.amount), createdAt: transaction.createdAt },
    amount: value,
  };
}

export async function cancelGiftCard(id) {
  const card = await prisma.giftCard.findUnique({ where: { id } });
  if (!card) throw new NotFoundError('Gift card not found');
  if (card.status !== 'ACTIVE') throw new ConflictError(`Only an active gift card can be cancelled (this one is ${card.status.toLowerCase()})`);
  const updated = await prisma.giftCard.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: { customer: { select: { id: true, name: true } } },
  });
  return shapeGiftCard(updated);
}

// =============================== SURVEYS =====================================

export async function createSurveyInvite({ customerId = null, appointmentId = null } = {}) {
  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundError('Customer not found');
  }
  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } });
    if (!appointment) throw new NotFoundError('Appointment not found');
  }
  const invite = await prisma.surveyResponse.create({
    data: { token: crypto.randomUUID(), customerId, appointmentId },
  });
  return {
    id: invite.id,
    token: invite.token,
    customerId: invite.customerId,
    appointmentId: invite.appointmentId,
    sentAt: invite.sentAt,
    path: `/survey/${invite.token}`,
  };
}

// PUBLIC view — deliberately minimal: no ids, no patient data, no PHI.
export async function getSurveyByToken(token) {
  const row = await prisma.surveyResponse.findUnique({
    where: { token: String(token || '') },
    select: { token: true, respondedAt: true },
  });
  if (!row) throw new NotFoundError('This survey link is not valid');
  return { token: row.token, clinicName: await clinicName(), answered: !!row.respondedAt };
}

export async function submitSurvey(token, { rating, comment } = {}) {
  const row = await prisma.surveyResponse.findUnique({ where: { token: String(token || '') } });
  if (!row) throw new NotFoundError('This survey link is not valid');
  if (row.respondedAt) throw new ConflictError('This survey has already been answered — thank you!');

  const score = Number(rating);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new ValidationError('Rating must be a whole number between 1 and 5');
  }
  const text = comment ? String(comment).slice(0, 1000) : null;

  await prisma.surveyResponse.update({
    where: { id: row.id },
    data: { rating: score, comment: text, respondedAt: new Date() },
  });
  emitAll('survey:answered', { rating: score });
  return { ok: true, answered: true, rating: score };
}

export async function surveyStats() {
  const [invites, responses, avg, grouped] = await Promise.all([
    prisma.surveyResponse.count(),
    prisma.surveyResponse.count({ where: { respondedAt: { not: null } } }),
    prisma.surveyResponse.aggregate({ where: { rating: { not: null } }, _avg: { rating: true } }),
    prisma.surveyResponse.groupBy({
      by: ['rating'],
      where: { rating: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const g of grouped) if (g.rating >= 1 && g.rating <= 5) distribution[g.rating] = g._count._all;
  return {
    invites,
    responses,
    responseRate: invites > 0 ? Math.round((responses / invites) * 1000) / 10 : 0, // percent
    averageRating: avg._avg.rating ? Math.round(avg._avg.rating * 100) / 100 : 0,
    distribution,
  };
}

export async function listSurveyResponses({ limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await prisma.surveyResponse.findMany({
    where: { respondedAt: { not: null } },
    orderBy: { respondedAt: 'desc' },
    take,
    include: { customer: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    sentAt: r.sentAt,
    respondedAt: r.respondedAt,
    customerId: r.customerId,
    customerName: r.customer?.name || 'Anonymous',
  }));
}
