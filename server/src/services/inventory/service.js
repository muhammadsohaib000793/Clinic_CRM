// Inventory: product catalog, stock levels, the stock-movement ledger and the
// hourly low-stock watcher. Stock only ever changes through adjustStock(), so
// the movement ledger always explains the current on-hand quantity.
import cron from 'node-cron';
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors.js';
import { num, money } from '../../lib/money.js';
import { emitAll } from '../../realtime/emitter.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('inventory');

const ADJUST_TYPES = ['IN', 'OUT', 'ADJUST'];

// price/cost are Prisma Decimals — never let them leave the service raw.
function shape(p) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    price: num(p.price),
    cost: num(p.cost),
    stock: p.stock,
    lowStockThreshold: p.lowStockThreshold,
    active: p.active,
    lowStock: p.stock <= p.lowStockThreshold,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// Query params arrive as strings ("true"); internal callers pass real booleans.
function bool(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
}

function intInRange(value, { min = 0, max = 1e9, label }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function amount(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a number >= 0`);
  return money(n);
}

function text(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || null;
}

// Prisma 5 field references compare two columns inside SQL. Resolved lazily so
// an older client degrades to the in-memory filter in listProducts instead of
// throwing at import time.
function lowStockFieldRef() {
  return prisma.product?.fields?.lowStockThreshold || null;
}

export async function listProducts({ search, category, activeOnly, lowStockOnly, limit, offset } = {}) {
  const where = {};
  const term = typeof search === 'string' ? search.trim() : '';
  if (term) {
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { category: { contains: term, mode: 'insensitive' } },
    ];
  }
  if (category) where.category = category;
  if (bool(activeOnly)) where.active = true;

  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  const wantLowOnly = bool(lowStockOnly) === true;
  const ref = wantLowOnly ? lowStockFieldRef() : null;

  if (wantLowOnly && !ref) {
    // No column-comparison support: filter and page in memory so `total`
    // still reflects the low-stock subset.
    const rows = await prisma.product.findMany({ where, orderBy: { name: 'asc' } });
    const low = rows.map(shape).filter((p) => p.lowStock);
    return { products: low.slice(skip, skip + take), total: low.length };
  }
  if (ref) where.stock = { lte: ref };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
    prisma.product.count({ where }),
  ]);
  return { products: rows.map(shape), total };
}

export async function getProduct(id) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new NotFoundError('Product not found');
  return shape(product);
}

export async function createProduct(data = {}) {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw new ValidationError('Product name is required');

  const payload = {
    sku: text(data.sku),
    name,
    description: text(data.description),
    category: text(data.category),
    price: amount(data.price === undefined ? 0 : data.price, 'price'),
    cost: amount(data.cost === undefined ? 0 : data.cost, 'cost'),
    stock: intInRange(data.stock === undefined ? 0 : data.stock, { label: 'stock' }),
    lowStockThreshold: intInRange(data.lowStockThreshold === undefined ? 5 : data.lowStockThreshold, {
      label: 'lowStockThreshold',
    }),
    active: data.active === undefined ? true : !!data.active,
  };

  try {
    const product = shape(await prisma.product.create({ data: payload }));
    emitAll('inventory:product-changed', { action: 'created', product });
    return product;
  } catch (e) {
    if (e.code === 'P2002') throw new ConflictError('A product with that SKU already exists');
    throw e;
  }
}

// `stock` is deliberately not patchable here — it moves only via adjustStock()
// so every change lands in the movement ledger.
export async function updateProduct(id, data = {}) {
  const patch = {};
  if (data.name !== undefined) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) throw new ValidationError('Product name cannot be empty');
    patch.name = name;
  }
  if (data.sku !== undefined) patch.sku = text(data.sku);
  if (data.description !== undefined) patch.description = text(data.description);
  if (data.category !== undefined) patch.category = text(data.category);
  if (data.price !== undefined) patch.price = amount(data.price, 'price');
  if (data.cost !== undefined) patch.cost = amount(data.cost, 'cost');
  if (data.lowStockThreshold !== undefined) {
    patch.lowStockThreshold = intInRange(data.lowStockThreshold, { label: 'lowStockThreshold' });
  }
  if (data.active !== undefined) patch.active = !!data.active;

  try {
    const product = shape(await prisma.product.update({ where: { id }, data: patch }));
    emitAll('inventory:product-changed', { action: 'updated', product });
    return product;
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Product not found');
    if (e.code === 'P2002') throw new ConflictError('A product with that SKU already exists');
    throw e;
  }
}

export async function deleteProduct(id) {
  try {
    await prisma.product.delete({ where: { id } });
    emitAll('inventory:product-changed', { action: 'deleted', productId: id });
    return { ok: true, id };
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Product not found');
    throw e;
  }
}

export async function adjustStock({ productId, type, quantity, reason, agentId } = {}) {
  if (!productId || typeof productId !== 'string') throw new ValidationError('productId is required');
  const movementType = String(type || '').toUpperCase();
  if (!ADJUST_TYPES.includes(movementType)) {
    throw new ValidationError(`type must be one of ${ADJUST_TYPES.join(', ')}`);
  }
  const qty = Number(quantity);
  // ADJUST sets an absolute counted quantity, so 0 is legitimate there ("we
  // counted the shelf and it is empty"); IN/OUT are deltas and must be positive.
  const minQty = type === 'ADJUST' ? 0 : 1;
  if (!Number.isInteger(qty) || qty < minQty) {
    throw new ValidationError(
      type === 'ADJUST'
        ? 'quantity must be a whole number of 0 or more'
        : 'quantity must be a positive whole number',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id: productId } });
    if (!current) throw new NotFoundError('Product not found');

    const nextStock =
      movementType === 'IN' ? current.stock + qty : movementType === 'OUT' ? current.stock - qty : qty;
    if (nextStock < 0) {
      throw new ConflictError(`Only ${current.stock} unit(s) of "${current.name}" in stock — cannot remove ${qty}`);
    }

    const product = await tx.product.update({ where: { id: productId }, data: { stock: nextStock } });
    await tx.stockMovement.create({
      data: {
        productId,
        type: movementType,
        quantity: qty,
        reason: text(reason),
        agentId: agentId || null,
      },
    });
    return product;
  });

  const product = shape(updated);
  emitAll('inventory:stock-changed', { product, type: movementType, quantity: qty });
  if (product.active && product.lowStock) emitAll('inventory:low-stock', { products: [product] });
  return product;
}

export async function listMovements({ productId, limit } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const movements = await prisma.stockMovement.findMany({
    where: productId ? { productId } : {},
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return movements.map((m) => ({
    id: m.id,
    productId: m.productId,
    productName: m.product?.name || null,
    productSku: m.product?.sku || null,
    type: m.type,
    quantity: m.quantity,
    reason: m.reason,
    agentId: m.agentId,
    paymentId: m.paymentId,
    createdAt: m.createdAt,
  }));
}

// Active products at or below their threshold, worst shortfall first.
export async function lowStockProducts() {
  const ref = lowStockFieldRef();
  const rows = await prisma.product.findMany({
    where: ref ? { active: true, stock: { lte: ref } } : { active: true },
  });
  return rows
    .map(shape)
    .filter((p) => p.lowStock)
    .sort((a, b) => b.lowStockThreshold - b.stock - (a.lowStockThreshold - a.stock));
}

export async function inventoryStats() {
  // Inactive products are never restocked, so they are excluded from the
  // low/out-of-stock alerts but still counted in the catalog total.
  const rows = await prisma.product.findMany({
    select: { stock: true, cost: true, lowStockThreshold: true, active: true },
  });
  const active = rows.filter((p) => p.active);
  return {
    totalProducts: rows.length,
    lowStockCount: active.filter((p) => p.stock <= p.lowStockThreshold).length,
    outOfStockCount: active.filter((p) => p.stock <= 0).length,
    stockValue: money(rows.reduce((sum, p) => sum + p.stock * num(p.cost), 0)),
  };
}

export async function lowStockSweep() {
  const products = await lowStockProducts();
  if (products.length) {
    emitAll('inventory:low-stock', { products });
    log.warn(`${products.length} product(s) at or below their low-stock threshold`, {
      items: products.map((p) => `${p.name}: ${p.stock}/${p.lowStockThreshold}`),
    });
  }
  return { low: products.length, products };
}

export function startLowStockWatcher() {
  const task = cron.schedule('0 * * * *', () => {
    lowStockSweep().catch((err) => log.error('Low-stock sweep failed', { error: err.message }));
  });
  log.info('Low-stock watcher started (runs hourly)');
  // Run once shortly after boot so an already-depleted shelf alerts immediately.
  setTimeout(() => lowStockSweep().catch(() => {}), 5000);
  return task;
}
