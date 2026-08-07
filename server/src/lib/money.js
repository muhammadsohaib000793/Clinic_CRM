// Money helpers. Prisma returns Decimal columns as Decimal.js instances, which
// serialize to JSON as strings — the UI wants numbers. Every service that reads
// a Decimal column MUST map it through num() before returning it to a route.
// Amounts are rounded to 2 decimals; a clinic never needs more precision.

export function num(value) {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'object' && typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// Round a computed amount to cents (use before writing a Decimal column).
export function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

// Deep-convert the Decimal fields listed in `fields` on a record (or array).
export function decimalsToNumbers(record, fields) {
  if (Array.isArray(record)) return record.map((r) => decimalsToNumbers(r, fields));
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };
  for (const f of fields) if (f in out) out[f] = num(out[f]);
  return out;
}
