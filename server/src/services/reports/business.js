// Business reports: money taken (financial), attendance / no-shows and
// professional commissions, plus a compact KPI bundle for the dashboard.
// Read-only aggregation — nothing here writes. Prisma hands back every Decimal
// column as a Decimal object, so amounts are mapped through num()/money()
// before they leave this module and empty ranges return zeros, never null/NaN.
import { prisma } from '../../db/prisma.js';
import { ValidationError } from '../../lib/errors.js';
import { num, money } from '../../lib/money.js';

const DEFAULT_DAYS = 30;
const MAX_RANGE_DAYS = 731; // two years — keeps a stray query from scanning everything
const TOP_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// --------------------------------- helpers ----------------------------------

function parseBoundary(value, label, endOfDay) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${label} must be a valid date`);
  // A bare YYYY-MM-DD "to" means the whole of that day, not midnight.
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) d.setHours(23, 59, 59, 999);
  return d;
}

// Every report shares this range contract: default = the last 30 days.
function resolveRange({ from, to } = {}) {
  const hasFrom = from !== undefined && from !== null && from !== '';
  const hasTo = to !== undefined && to !== null && to !== '';
  const end = hasTo ? parseBoundary(to, 'to', true) : new Date();
  const start = hasFrom ? parseBoundary(from, 'from', false) : new Date(end.getTime() - DEFAULT_DAYS * DAY_MS);
  if (start.getTime() > end.getTime()) throw new ValidationError('"from" must be before "to"');
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new ValidationError(`The range cannot be longer than ${MAX_RANGE_DAYS} days`);
  }
  return { start, end, range: { from: start.toISOString(), to: end.toISOString() } };
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Percentage with one decimal; an empty denominator is 0, never NaN.
function rate(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function sortedDays(map, shape) {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => shape(date, v));
}

// -------------------------------- financial ---------------------------------

export async function financialReport({ from, to } = {}) {
  const { start, end, range } = resolveRange({ from, to });

  // Takings are booked on the day the money landed (paidAt); a legacy row with
  // no paidAt falls back to its creation date so it is never silently dropped.
  const paidWhere = {
    status: 'PAID',
    OR: [{ paidAt: { gte: start, lte: end } }, { paidAt: null, createdAt: { gte: start, lte: end } }],
  };

  const [payments, refundAgg] = await Promise.all([
    prisma.payment.findMany({
      where: paidWhere,
      select: {
        subtotal: true,
        discount: true,
        tax: true,
        total: true,
        method: true,
        paidAt: true,
        createdAt: true,
        items: {
          select: {
            kind: true,
            quantity: true,
            total: true,
            description: true,
            serviceId: true,
            productId: true,
            service: { select: { name: true } },
            product: { select: { name: true } },
          },
        },
      },
    }),
    prisma.payment.aggregate({
      where: { status: 'REFUNDED', createdAt: { gte: start, lte: end } },
      _sum: { total: true },
    }),
  ]);

  let gross = 0;
  let discounts = 0;
  let tax = 0;
  let net = 0;
  const byMethod = new Map();
  const byDay = new Map();
  const services = new Map();
  const products = new Map();

  for (const p of payments) {
    const total = num(p.total);
    gross += num(p.subtotal);
    discounts += num(p.discount);
    tax += num(p.tax);
    net += total;

    const m = byMethod.get(p.method) || { method: p.method, count: 0, total: 0 };
    m.count += 1;
    m.total += total;
    byMethod.set(p.method, m);

    const key = dayKey(p.paidAt || p.createdAt);
    const d = byDay.get(key) || { total: 0, count: 0 };
    d.total += total;
    d.count += 1;
    byDay.set(key, d);

    for (const item of p.items || []) {
      if (item.kind === 'SERVICE' && item.serviceId) {
        const row = services.get(item.serviceId) || {
          serviceId: item.serviceId,
          name: (item.service && item.service.name) || item.description || 'Service',
          quantity: 0,
          revenue: 0,
        };
        row.quantity += item.quantity;
        row.revenue += num(item.total);
        services.set(item.serviceId, row);
      } else if (item.kind === 'PRODUCT' && item.productId) {
        const row = products.get(item.productId) || {
          productId: item.productId,
          name: (item.product && item.product.name) || item.description || 'Product',
          quantity: 0,
          revenue: 0,
        };
        row.quantity += item.quantity;
        row.revenue += num(item.total);
        products.set(item.productId, row);
      }
    }
  }

  const transactions = payments.length;
  const topBy = (map) =>
    [...map.values()]
      .map((r) => ({ ...r, revenue: money(r.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_LIMIT);

  return {
    range,
    totals: {
      gross: money(gross),
      discounts: money(discounts),
      tax: money(tax),
      net: money(net),
      refunds: num(refundAgg._sum.total),
      transactions,
      averageTicket: transactions ? money(net / transactions) : 0,
    },
    byMethod: [...byMethod.values()]
      .map((m) => ({ ...m, total: money(m.total) }))
      .sort((a, b) => b.total - a.total),
    byDay: sortedDays(byDay, (date, v) => ({ date, total: money(v.total), count: v.count })),
    topServices: topBy(services),
    topProducts: topBy(products),
  };
}

// -------------------------------- attendance --------------------------------

export async function attendanceReport({ from, to } = {}) {
  const { start, end, range } = resolveRange({ from, to });

  const appointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: start, lte: end } },
    select: {
      status: true,
      source: true,
      scheduledAt: true,
      doctorId: true,
      doctor: { select: { id: true, name: true } },
    },
  });

  let confirmed = 0;
  let completed = 0;
  let cancelled = 0;
  let noShow = 0;
  const byDoctor = new Map();
  const bySource = new Map();
  const byDay = new Map();

  for (const a of appointments) {
    if (a.status === 'CONFIRMED') confirmed += 1;
    else if (a.status === 'COMPLETED') completed += 1;
    else if (a.status === 'CANCELLED') cancelled += 1;
    else if (a.status === 'NO_SHOW') noShow += 1;

    const doc = byDoctor.get(a.doctorId) || {
      doctorId: a.doctorId,
      name: (a.doctor && a.doctor.name) || 'Unknown',
      total: 0,
      completed: 0,
      noShow: 0,
    };
    doc.total += 1;
    if (a.status === 'COMPLETED') doc.completed += 1;
    if (a.status === 'NO_SHOW') doc.noShow += 1;
    byDoctor.set(a.doctorId, doc);

    bySource.set(a.source, (bySource.get(a.source) || 0) + 1);

    const key = dayKey(a.scheduledAt);
    const day = byDay.get(key) || { total: 0, noShow: 0 };
    day.total += 1;
    if (a.status === 'NO_SHOW') day.noShow += 1;
    byDay.set(key, day);
  }

  const total = appointments.length;

  return {
    range,
    totals: {
      total,
      confirmed,
      completed,
      cancelled,
      noShow,
      noShowRate: rate(noShow, total),
      cancellationRate: rate(cancelled, total),
    },
    byDoctor: [...byDoctor.values()]
      .map((d) => ({ ...d, noShowRate: rate(d.noShow, d.total) }))
      .sort((a, b) => b.total - a.total),
    bySource: [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    byDay: sortedDays(byDay, (date, v) => ({ date, total: v.total, noShow: v.noShow })),
  };
}

// -------------------------------- commissions -------------------------------

export async function commissionReport({ from, to, doctorId } = {}) {
  const { start, end, range } = resolveRange({ from, to });

  const where = { createdAt: { gte: start, lte: end } };
  if (doctorId) where.doctorId = String(doctorId);

  const rows = await prisma.commission.findMany({
    where,
    select: {
      doctorId: true,
      amount: true,
      status: true,
      doctor: { select: { id: true, name: true } },
    },
  });

  let pending = 0;
  let paid = 0;
  const byDoctor = new Map();

  for (const c of rows) {
    const amount = num(c.amount);
    if (c.status === 'PAID') paid += amount;
    else pending += amount;

    const doc = byDoctor.get(c.doctorId) || {
      doctorId: c.doctorId,
      name: (c.doctor && c.doctor.name) || 'Unknown',
      pending: 0,
      paid: 0,
      total: 0,
      items: 0,
    };
    doc.items += 1;
    doc.total += amount;
    if (c.status === 'PAID') doc.paid += amount;
    else doc.pending += amount;
    byDoctor.set(c.doctorId, doc);
  }

  return {
    range,
    totals: { pending: money(pending), paid: money(paid), total: money(pending + paid) },
    byDoctor: [...byDoctor.values()]
      .map((d) => ({ ...d, pending: money(d.pending), paid: money(d.paid), total: money(d.total) }))
      .sort((a, b) => b.total - a.total),
  };
}

// ------------------------------ clinic overview -----------------------------

export async function clinicOverview({ from, to } = {}) {
  const { start, end, range } = resolveRange({ from, to });
  // Pass the resolved boundaries down so every figure covers the exact same
  // window (re-defaulting per call would drift by milliseconds).
  const scoped = { from: range.from, to: range.to };

  const [financial, attendance, commissions, newCustomers, onlineBookings, stock] = await Promise.all([
    financialReport(scoped),
    attendanceReport(scoped),
    commissionReport(scoped),
    prisma.customer.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.appointment.count({ where: { scheduledAt: { gte: start, lte: end }, source: 'ONLINE' } }),
    // Column-to-column comparison is filtered in memory so the query works on
    // any Prisma client version.
    prisma.product.findMany({ where: { active: true }, select: { stock: true, lowStockThreshold: true } }),
  ]);

  return {
    range,
    revenue: financial.totals.net,
    appointments: attendance.totals.total,
    newCustomers,
    noShowRate: attendance.totals.noShowRate,
    onlineBookings,
    averageTicket: financial.totals.averageTicket,
    lowStockCount: stock.filter((p) => p.stock <= p.lowStockThreshold).length,
    pendingCommissions: commissions.totals.pending,
  };
}
