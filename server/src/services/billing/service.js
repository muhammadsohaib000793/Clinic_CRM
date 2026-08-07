// Payments / POS: the till sale (services + products), receipts, refunds,
// payment links, the cash register (open / movements / close) and professional
// commissions. Prisma returns every Decimal column as a Decimal object, so all
// amounts are rounded with money() before they are written and mapped through
// num() before they leave this module.
import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors.js';
import { num, money } from '../../lib/money.js';
import { emitAll } from '../../realtime/emitter.js';
import { getSetting } from '../settings/service.js';

const METHODS = ['CASH', 'CARD', 'TRANSFER', 'ONLINE_LINK', 'GIFT_CARD', 'OTHER'];
const STATUSES = ['PENDING', 'PAID', 'REFUNDED', 'VOID'];
const KINDS = ['SERVICE', 'PRODUCT', 'OTHER'];
const MANUAL_MOVEMENTS = ['CASH_IN', 'CASH_OUT']; // SALE / REFUND are written by the system
const COMMISSION_STATUSES = ['PENDING', 'PAID'];

// An unpaid payment link older than this is treated as expired.
const LINK_TTL_DAYS = 30;

const PAYMENT_INCLUDE = {
  items: {
    include: {
      service: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
      doctor: { select: { id: true, name: true } },
    },
  },
  customer: { select: { id: true, name: true, phone: true, email: true } },
  appointment: { select: { id: true, scheduledAt: true, doctorId: true } },
};

// --------------------------------- helpers ----------------------------------

function shapeItem(i) {
  return {
    id: i.id,
    kind: i.kind,
    serviceId: i.serviceId,
    productId: i.productId,
    doctorId: i.doctorId,
    doctorName: i.doctor ? i.doctor.name : null,
    description: i.description,
    quantity: i.quantity,
    unitPrice: num(i.unitPrice),
    total: num(i.total),
  };
}

function shapePayment(p) {
  if (!p) return null;
  return {
    id: p.id,
    receiptNumber: p.receiptNumber,
    customerId: p.customerId,
    customer: p.customer
      ? { id: p.customer.id, name: p.customer.name, phone: p.customer.phone, email: p.customer.email }
      : null,
    appointmentId: p.appointmentId,
    appointment: p.appointment ? { id: p.appointment.id, scheduledAt: p.appointment.scheduledAt } : null,
    cashSessionId: p.cashSessionId,
    subtotal: num(p.subtotal),
    discount: num(p.discount),
    tax: num(p.tax),
    total: num(p.total),
    method: p.method,
    status: p.status,
    reference: p.reference,
    publicToken: p.publicToken,
    notes: p.notes,
    paidAt: p.paidAt,
    createdByAgentId: p.createdByAgentId,
    createdAt: p.createdAt,
    items: (p.items || []).map(shapeItem),
  };
}

function amountOf(value, label, { positive = false } = {}) {
  const raw = value === undefined || value === null || value === '' ? 0 : value;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a number >= 0`);
  if (positive && n <= 0) throw new ValidationError(`${label} must be greater than 0`);
  return money(n);
}

function quantityOf(value) {
  const n = Number(value === undefined || value === null || value === '' ? 1 : value);
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new ValidationError('quantity must be a whole number between 1 and 9999');
  }
  return n;
}

function textOf(value, max = 300) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function parseFrom(value, label = 'from') {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${label} must be a valid date`);
  return d;
}

// A bare YYYY-MM-DD "to" means "the whole of that day", not midnight.
function parseTo(value, label = 'to') {
  const d = parseFrom(value, label);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) d.setHours(23, 59, 59, 999);
  return d;
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function appendNote(existing, line) {
  return existing ? `${existing}\n${line}` : line;
}

async function clinicName() {
  const name = await getSetting('clinic_name', 'Clinic');
  return name || 'Clinic';
}

// --------------------------------- the sale ---------------------------------

// Core POS sale. Everything (items, stock, commissions, cash movement) happens
// inside ONE transaction so a failed stock check cannot leave a half-written sale.
export async function createPayment({
  customerId,
  appointmentId,
  items,
  method = 'CASH',
  discount,
  tax,
  notes,
  reference,
  agent,
  giftCardCode,
} = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError('At least one item is required');
  if (!METHODS.includes(method)) throw new ValidationError(`method must be one of: ${METHODS.join(', ')}`);
  const discountAmount = amountOf(discount, 'discount');
  const taxAmount = amountOf(tax, 'tax');
  const isLink = method === 'ONLINE_LINK';
  const isCash = method === 'CASH';
  const isGiftCard = method === 'GIFT_CARD';
  const cardCode = isGiftCard ? String(giftCardCode || '').trim().toUpperCase() : '';
  if (isGiftCard && !cardCode) throw new ValidationError('A gift card code is required to pay with a gift card');

  const created = await prisma.$transaction(async (tx) => {
    if (customerId) {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) throw new NotFoundError('Customer not found');
    }
    if (appointmentId) {
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } });
      if (!appointment) throw new NotFoundError('Appointment not found');
    }

    const products = new Map(); // productId -> product row (loaded once)
    const needed = new Map(); // productId -> units sold across all lines
    const doctors = new Map();
    const lines = [];

    for (const raw of items) {
      if (!raw || typeof raw !== 'object') throw new ValidationError('Each item must be an object');
      const kind = raw.kind
        ? String(raw.kind).toUpperCase()
        : raw.productId
          ? 'PRODUCT'
          : raw.serviceId
            ? 'SERVICE'
            : 'OTHER';
      if (!KINDS.includes(kind)) throw new ValidationError(`item.kind must be one of: ${KINDS.join(', ')}`);

      const quantity = quantityOf(raw.quantity);
      let description = textOf(raw.description);
      let unitPrice;
      let service = null;
      let doctor = null;

      if (raw.doctorId) {
        if (!doctors.has(raw.doctorId)) {
          const found = await tx.doctor.findUnique({ where: { id: raw.doctorId } });
          if (!found) throw new NotFoundError(`Doctor not found: ${raw.doctorId}`);
          doctors.set(raw.doctorId, found);
        }
        doctor = doctors.get(raw.doctorId);
      }

      if (kind === 'PRODUCT') {
        if (!raw.productId) throw new ValidationError('A product line requires a productId');
        if (!products.has(raw.productId)) {
          const found = await tx.product.findUnique({ where: { id: raw.productId } });
          if (!found) throw new NotFoundError(`Product not found: ${raw.productId}`);
          products.set(raw.productId, found);
        }
        const product = products.get(raw.productId);
        description = description || product.name;
        // Stock items are always sold at the catalogue price — a client-supplied
        // price is never trusted here.
        unitPrice = num(product.price);
        needed.set(raw.productId, (needed.get(raw.productId) || 0) + quantity);
      } else if (kind === 'SERVICE') {
        if (raw.serviceId) {
          service = await tx.service.findUnique({ where: { id: raw.serviceId } });
          if (!service) throw new NotFoundError(`Service not found: ${raw.serviceId}`);
          description = description || service.name;
          // A service price MAY be overridden at the till; the catalogue price is the default.
          unitPrice =
            raw.unitPrice === undefined || raw.unitPrice === null || raw.unitPrice === ''
              ? num(service.price)
              : amountOf(raw.unitPrice, 'unitPrice');
        } else {
          if (!description) throw new ValidationError('A service line needs a serviceId or a description');
          unitPrice = amountOf(raw.unitPrice, 'unitPrice');
        }
      } else {
        if (!description) throw new ValidationError('A free-text line needs a description');
        unitPrice = amountOf(raw.unitPrice, 'unitPrice');
      }

      lines.push({
        kind,
        serviceId: kind === 'SERVICE' && raw.serviceId ? raw.serviceId : null,
        productId: kind === 'PRODUCT' ? raw.productId : null,
        doctorId: doctor ? doctor.id : null,
        doctor,
        service,
        description,
        quantity,
        unitPrice,
        total: money(unitPrice * quantity),
      });
    }

    const subtotal = money(lines.reduce((sum, l) => sum + l.total, 0));
    if (discountAmount > subtotal) throw new ValidationError('Discount cannot be greater than the subtotal');
    const total = money(subtotal - discountAmount + taxAmount);
    if (total < 0) throw new ValidationError('Total cannot be negative');

    for (const [productId, units] of needed) {
      const product = products.get(productId);
      if (product.stock < units) {
        throw new ConflictError(`Not enough stock for "${product.name}" — ${product.stock} left, ${units} requested`);
      }
    }

    // Cash sales are booked against the register that is currently open (if any).
    const openSession = isCash
      ? await tx.cashSession.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
      : null;

    const payment = await tx.payment.create({
      data: {
        customerId: customerId || null,
        appointmentId: appointmentId || null,
        cashSessionId: openSession ? openSession.id : null,
        subtotal,
        discount: discountAmount,
        tax: taxAmount,
        total,
        method,
        status: isLink ? 'PENDING' : 'PAID',
        paidAt: isLink ? null : new Date(),
        publicToken: isLink ? crypto.randomUUID() : null,
        reference: textOf(reference, 120),
        notes: textOf(notes, 1000),
        createdByAgentId: agent && agent.id ? agent.id : null,
      },
    });

    // Paying with a gift card must actually DEBIT the card, inside this same
    // transaction. The conditional decrement is the guard — it fails when the
    // card is missing, inactive, expired or short of funds, which rolls the
    // whole sale back rather than booking a payment nothing paid for.
    if (isGiftCard) {
      const card = await tx.giftCard.findUnique({ where: { code: cardCode } });
      if (!card) throw new NotFoundError('Gift card not found');
      if (card.expiresAt && card.expiresAt.getTime() < Date.now()) {
        throw new ConflictError('This gift card has expired');
      }
      const debited = await tx.giftCard.updateMany({
        where: { code: cardCode, status: 'ACTIVE', balance: { gte: total } },
        data: { balance: { decrement: total } },
      });
      if (debited.count === 0) {
        throw new ConflictError('Gift card is inactive or does not have enough balance for this sale');
      }
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: card.id,
          amount: -total, // negative = redeemed
          paymentId: payment.id,
          note: `Sale · receipt #${payment.receiptNumber}`,
        },
      });
      const fresh = await tx.giftCard.findUnique({ where: { id: card.id }, select: { balance: true } });
      if (num(fresh.balance) <= 0) {
        await tx.giftCard.update({ where: { id: card.id }, data: { status: 'REDEEMED' } });
      }
    }

    for (const line of lines) {
      const item = await tx.paymentItem.create({
        data: {
          paymentId: payment.id,
          kind: line.kind,
          serviceId: line.serviceId,
          productId: line.productId,
          doctorId: line.doctorId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          total: line.total,
        },
      });

      if (line.kind === 'PRODUCT' && line.productId) {
        // Conditional decrement is the real oversell guard: the stock check above
        // reads a snapshot, so two concurrent tills selling the last unit would
        // both pass it. `count === 0` means someone else took the stock first.
        const dec = await tx.product.updateMany({
          where: { id: line.productId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (dec.count === 0) {
          throw new ConflictError(`Not enough stock for "${line.description}" — it sold out during checkout`);
        }
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            type: 'SALE',
            quantity: line.quantity,
            reason: `Sale · receipt #${payment.receiptNumber}`,
            agentId: agent && agent.id ? agent.id : null,
            paymentId: payment.id,
          },
        });
      }

      // Commission: the service rate wins when set, otherwise the professional's own rate.
      if (line.kind === 'SERVICE' && line.doctor) {
        const serviceRate = line.service ? num(line.service.commissionRate) : 0;
        const rate = serviceRate > 0 ? serviceRate : num(line.doctor.commissionRate);
        if (rate > 0) {
          await tx.commission.create({
            data: {
              doctorId: line.doctor.id,
              paymentId: payment.id,
              paymentItemId: item.id,
              baseAmount: line.total,
              rate,
              amount: money((line.total * rate) / 100),
              status: 'PENDING',
            },
          });
        }
      }
    }

    if (openSession && total > 0) {
      await tx.cashMovement.create({
        data: {
          sessionId: openSession.id,
          type: 'SALE',
          amount: total,
          reason: `Sale · receipt #${payment.receiptNumber}`,
          paymentId: payment.id,
          agentId: agent && agent.id ? agent.id : null,
        },
      });
    }

    return tx.payment.findUnique({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
  });

  const payment = shapePayment(created);
  emitAll('payment:created', { payment });
  return payment;
}

export async function listPayments({ from, to, status, method, customerId, limit, offset } = {}) {
  const where = {};
  const gte = parseFrom(from);
  const lte = parseTo(to);
  if (gte || lte) where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  if (status) {
    const s = String(status).toUpperCase();
    if (!STATUSES.includes(s)) throw new ValidationError(`status must be one of: ${STATUSES.join(', ')}`);
    where.status = s;
  }
  if (method) {
    const m = String(method).toUpperCase();
    if (!METHODS.includes(m)) throw new ValidationError(`method must be one of: ${METHODS.join(', ')}`);
    where.method = m;
  }
  if (customerId) where.customerId = customerId;

  const take = clampInt(limit, 50, 1, 200);
  const skip = clampInt(offset, 0, 0, 1000000);

  const [rows, total] = await prisma.$transaction([
    prisma.payment.findMany({ where, include: PAYMENT_INCLUDE, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.payment.count({ where }),
  ]);

  return { payments: rows.map(shapePayment), total };
}

export async function getPayment(id) {
  const payment = await prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
  if (!payment) throw new NotFoundError('Payment not found');
  return shapePayment(payment);
}

// Reverses the sale: stock back in, commissions cancelled (deleted — the enum has
// no cancelled state), cash refunded on the register. Refunding twice conflicts.
export async function refundPayment(id, { reason, agent } = {}) {
  const existing = await prisma.payment.findUnique({ where: { id }, include: { items: true } });
  if (!existing) throw new NotFoundError('Payment not found');
  if (existing.status === 'REFUNDED') throw new ConflictError('This payment has already been refunded');
  if (existing.status === 'VOID') throw new ConflictError('A void payment cannot be refunded');

  const refunded = await prisma.$transaction(async (tx) => {
    // Guarded update — also protects against two refunds racing each other.
    const marked = await tx.payment.updateMany({
      where: { id, status: { not: 'REFUNDED' } },
      data: {
        status: 'REFUNDED',
        notes: appendNote(
          existing.notes,
          `Refunded by ${agent && agent.name ? agent.name : 'system'}${reason ? ` — ${textOf(reason, 300)}` : ''}`,
        ),
      },
    });
    if (marked.count === 0) throw new ConflictError('This payment has already been refunded');

    for (const item of existing.items) {
      if (item.kind === 'PRODUCT' && item.productId) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'IN',
            quantity: item.quantity,
            reason: `Refund · receipt #${existing.receiptNumber}`,
            agentId: agent && agent.id ? agent.id : null,
            paymentId: existing.id,
          },
        });
      }
    }

    await tx.commission.deleteMany({ where: { paymentId: existing.id } });

    const total = num(existing.total);
    if (existing.method === 'CASH' && existing.cashSessionId && total > 0) {
      const session = await tx.cashSession.findUnique({ where: { id: existing.cashSessionId } });
      if (session && session.status === 'OPEN') {
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: 'REFUND',
            amount: total,
            reason: `Refund · receipt #${existing.receiptNumber}${reason ? ` — ${textOf(reason, 200)}` : ''}`,
            paymentId: existing.id,
            agentId: agent && agent.id ? agent.id : null,
          },
        });
      }
    }

    return tx.payment.findUnique({ where: { id: existing.id }, include: PAYMENT_INCLUDE });
  });

  const payment = shapePayment(refunded);
  emitAll('payment:refunded', { payment });
  return payment;
}

export async function receiptData(id) {
  const payment = await getPayment(id);
  return {
    receiptNumber: payment.receiptNumber,
    issuedAt: payment.paidAt || payment.createdAt,
    clinic: { name: await clinicName() },
    customer: payment.customer
      ? { name: payment.customer.name, phone: payment.customer.phone, email: payment.customer.email }
      : null,
    items: payment.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.total,
      staff: i.doctorName,
    })),
    subtotal: payment.subtotal,
    discount: payment.discount,
    tax: payment.tax,
    total: payment.total,
    method: payment.method,
    status: payment.status,
    reference: payment.reference,
  };
}

// ------------------------------ payment links -------------------------------
// NOTE: real card capture requires a payment gateway (Stripe, Mercado Pago, …).
// This module only RECORDS the payment: the public link page confirms it
// manually until a gateway is configured, at which point markLinkPaid() becomes
// the gateway webhook's callback.

export async function createPaymentLink({ customerId, appointmentId, amount, description } = {}) {
  const value = amountOf(amount, 'amount', { positive: true });
  const label = textOf(description) || 'Payment';

  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundError('Customer not found');
  }
  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } });
    if (!appointment) throw new NotFoundError('Appointment not found');
  }

  const created = await prisma.payment.create({
    data: {
      customerId: customerId || null,
      appointmentId: appointmentId || null,
      subtotal: value,
      discount: 0,
      tax: 0,
      total: value,
      method: 'ONLINE_LINK',
      status: 'PENDING',
      publicToken: crypto.randomUUID(),
      items: { create: [{ kind: 'OTHER', description: label, quantity: 1, unitPrice: value, total: value }] },
    },
    include: PAYMENT_INCLUDE,
  });

  const payment = shapePayment(created);
  emitAll('payment:link_created', { paymentId: payment.id, total: payment.total });
  return payment;
}

function linkExpired(payment) {
  const age = Date.now() - new Date(payment.createdAt).getTime();
  return age > LINK_TTL_DAYS * 24 * 60 * 60 * 1000;
}

async function publicLinkView(payment, description) {
  const status =
    payment.status === 'PAID'
      ? 'PAID'
      : payment.status === 'PENDING'
        ? linkExpired(payment)
          ? 'EXPIRED'
          : 'PENDING'
        : 'CANCELLED';
  return {
    token: payment.publicToken,
    amount: num(payment.total),
    description: description || 'Payment',
    status,
    clinicName: await clinicName(),
  };
}

// Public view — deliberately minimal: no ids, no customer data, no internals.
export async function getPaymentByToken(token) {
  if (!token || typeof token !== 'string') throw new NotFoundError('Payment link not found');
  const payment = await prisma.payment.findUnique({
    where: { publicToken: token },
    include: { items: { select: { description: true } } },
  });
  if (!payment) throw new NotFoundError('Payment link not found');
  const description = (payment.items || []).map((i) => i.description).join(', ');
  return publicLinkView(payment, description);
}

export async function markLinkPaid(token, { reference } = {}) {
  if (!token || typeof token !== 'string') throw new NotFoundError('Payment link not found');
  const payment = await prisma.payment.findUnique({
    where: { publicToken: token },
    include: { items: { select: { description: true } } },
  });
  if (!payment) throw new NotFoundError('Payment link not found');
  if (payment.status === 'PAID') throw new ConflictError('This payment link has already been paid');
  if (payment.status !== 'PENDING') throw new ConflictError('This payment link is no longer valid');
  if (linkExpired(payment)) throw new ConflictError('This payment link has expired');

  const marked = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'PENDING' },
    data: { status: 'PAID', paidAt: new Date(), reference: textOf(reference, 120) || payment.reference },
  });
  if (marked.count === 0) throw new ConflictError('This payment link has already been paid');

  emitAll('payment:link_paid', { paymentId: payment.id, total: num(payment.total) });
  const description = (payment.items || []).map((i) => i.description).join(', ');
  return publicLinkView({ ...payment, status: 'PAID' }, description);
}

// ------------------------------- cash register ------------------------------

function shapeSession(s) {
  if (!s) return null;
  const movements = s.movements || [];
  let sales = 0;
  let refunds = 0;
  let cashIn = 0;
  let cashOut = 0;
  for (const m of movements) {
    const a = num(m.amount);
    if (m.type === 'SALE') sales += a;
    else if (m.type === 'REFUND') refunds += a;
    else if (m.type === 'CASH_IN') cashIn += a;
    else if (m.type === 'CASH_OUT') cashOut += a;
  }
  const openingFloat = num(s.openingFloat);
  // A closed session keeps the figures computed at closing time; an open one is live.
  const expectedTotal =
    s.status === 'CLOSED' && s.expectedTotal !== null && s.expectedTotal !== undefined
      ? num(s.expectedTotal)
      : money(openingFloat + sales - refunds + cashIn - cashOut);

  return {
    id: s.id,
    status: s.status,
    openedAt: s.openedAt,
    openedByAgentId: s.openedByAgentId,
    openedByName: s.openedByName,
    openingFloat,
    closedAt: s.closedAt,
    closingCount: s.closingCount === null || s.closingCount === undefined ? null : num(s.closingCount),
    expectedTotal,
    difference: s.difference === null || s.difference === undefined ? null : num(s.difference),
    notes: s.notes,
    sales: money(sales),
    refunds: money(refunds),
    cashIn: money(cashIn),
    cashOut: money(cashOut),
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      amount: num(m.amount),
      reason: m.reason,
      paymentId: m.paymentId,
      createdAt: m.createdAt,
    })),
  };
}

const SESSION_INCLUDE = { movements: { orderBy: { createdAt: 'desc' } } };

export async function openCashSession({ openingFloat, agent } = {}) {
  const float = amountOf(openingFloat, 'openingFloat');

  // Serializable: two agents pressing "Open register" at the same moment would
  // otherwise both see no open session and create two, after which every cash
  // sale books against the newest one and the older can never be closed.
  const session = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.cashSession.findFirst({ where: { status: 'OPEN' } });
      if (existing) {
        throw new ConflictError('A cash session is already open — close it before opening a new one');
      }
      return tx.cashSession.create({
        data: {
          openingFloat: float,
          openedByAgentId: agent && agent.id ? agent.id : null,
          openedByName: agent && agent.name ? agent.name : null,
        },
        include: SESSION_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' },
  );

  const shaped = shapeSession(session);
  emitAll('cash:changed', { action: 'opened', session: shaped });
  return shaped;
}

export async function getOpenSession() {
  const session = await prisma.cashSession.findFirst({
    where: { status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    include: SESSION_INCLUDE,
  });
  return shapeSession(session);
}

export async function addCashMovement({ type, amount, reason, agent } = {}) {
  const t = type ? String(type).toUpperCase() : '';
  if (!MANUAL_MOVEMENTS.includes(t)) {
    throw new ValidationError(`type must be one of: ${MANUAL_MOVEMENTS.join(', ')}`);
  }
  const value = amountOf(amount, 'amount', { positive: true });

  const session = await prisma.cashSession.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
  if (!session) throw new ConflictError('No cash session is open');

  await prisma.cashMovement.create({
    data: {
      sessionId: session.id,
      type: t,
      amount: value,
      reason: textOf(reason, 300),
      agentId: agent && agent.id ? agent.id : null,
    },
  });

  const updated = await prisma.cashSession.findUnique({ where: { id: session.id }, include: SESSION_INCLUDE });
  const shaped = shapeSession(updated);
  emitAll('cash:changed', { action: 'movement', session: shaped });
  return shaped;
}

export async function closeCashSession({ closingCount, notes, agent } = {}) {
  const counted = amountOf(closingCount, 'closingCount');
  const session = await prisma.cashSession.findFirst({
    where: { status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    include: SESSION_INCLUDE,
  });
  if (!session) throw new ConflictError('No cash session is open');

  const live = shapeSession(session);
  const expectedTotal = live.expectedTotal;
  const difference = money(counted - expectedTotal);

  const closed = await prisma.cashSession.update({
    where: { id: session.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closingCount: counted,
      expectedTotal,
      difference,
      notes: appendNote(session.notes, `Closed by ${agent && agent.name ? agent.name : 'system'}${notes ? ` — ${textOf(notes, 500)}` : ''}`),
    },
    include: SESSION_INCLUDE,
  });

  const shaped = shapeSession(closed);
  emitAll('cash:changed', { action: 'closed', session: shaped });
  return shaped;
}

export async function listCashSessions({ limit } = {}) {
  const take = clampInt(limit, 20, 1, 100);
  const sessions = await prisma.cashSession.findMany({
    orderBy: { openedAt: 'desc' },
    take,
    include: SESSION_INCLUDE,
  });
  return sessions.map(shapeSession);
}

// -------------------------------- commissions -------------------------------

export async function listCommissions({ doctorId, status, from, to } = {}) {
  const where = {};
  if (doctorId) where.doctorId = doctorId;
  if (status) {
    const s = String(status).toUpperCase();
    if (!COMMISSION_STATUSES.includes(s)) {
      throw new ValidationError(`status must be one of: ${COMMISSION_STATUSES.join(', ')}`);
    }
    where.status = s;
  }
  const gte = parseFrom(from);
  const lte = parseTo(to);
  if (gte || lte) where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };

  const rows = await prisma.commission.findMany({
    where,
    include: {
      doctor: { select: { id: true, name: true } },
      payment: { select: { id: true, receiptNumber: true, status: true } },
      paymentItem: { select: { description: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const commissions = rows.map((c) => ({
    id: c.id,
    doctorId: c.doctorId,
    doctorName: c.doctor ? c.doctor.name : null,
    paymentId: c.paymentId,
    receiptNumber: c.payment ? c.payment.receiptNumber : null,
    paymentStatus: c.payment ? c.payment.status : null,
    description: c.paymentItem ? c.paymentItem.description : null,
    baseAmount: num(c.baseAmount),
    rate: num(c.rate),
    amount: num(c.amount),
    status: c.status,
    paidAt: c.paidAt,
    createdAt: c.createdAt,
  }));

  const byDoctor = new Map();
  for (const c of commissions) {
    const key = c.doctorId;
    if (!byDoctor.has(key)) {
      byDoctor.set(key, { doctorId: key, doctorName: c.doctorName, pending: 0, paid: 0, total: 0, count: 0 });
    }
    const row = byDoctor.get(key);
    row.count += 1;
    row.total = money(row.total + c.amount);
    if (c.status === 'PAID') row.paid = money(row.paid + c.amount);
    else row.pending = money(row.pending + c.amount);
  }

  return { commissions, summary: [...byDoctor.values()].sort((a, b) => b.total - a.total) };
}

export async function payCommissions({ ids } = {}) {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((i) => typeof i === 'string' && i.trim()))] : [];
  if (list.length === 0) throw new ValidationError('ids must be a non-empty array of commission ids');

  const result = await prisma.commission.updateMany({
    where: { id: { in: list }, status: 'PENDING' },
    data: { status: 'PAID', paidAt: new Date() },
  });

  emitAll('commission:paid', { ids: list, count: result.count });
  return { ok: true, paid: result.count };
}
