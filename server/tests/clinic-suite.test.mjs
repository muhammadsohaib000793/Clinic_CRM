// End-to-end tests for the clinic suite (AgendaPro-parity modules):
// services catalog, public online booking, calendar, POS/payments/cash,
// inventory, marketing (loyalty/giftcards/surveys), clinical records,
// reminders and business reports.
// Run with:  npm --workspace server run test   (server must be up + seeded)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

let adminToken;
let agentToken;

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + `/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

let __seq = 0;
const uniq = () => `${Date.now()}${(__seq++).toString().padStart(4, '0')}`;
const nextDay = (s) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + 1); return ymd(d); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// A weekday inside the seeded availability (Mon–Fri), a few days out.
function futureWeekday(offsetDays = 3) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

before(async () => {
  const a = await req('/auth/login', { method: 'POST', body: { email: 'admin@weevolveit.mx', password: 'Admin123!321' } });
  assert.equal(a.status, 200, 'admin login must succeed');
  adminToken = a.data.token;
  const s = await req('/auth/login', { method: 'POST', body: { email: 'sofia@weevolveit.mx', password: 'Agent123!' } });
  agentToken = s.data.token;
});

// ------------------------------ Services catalog -----------------------------

test('SVC-01 seeded services are listed with their assigned professionals', async () => {
  const r = await req('/services', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.data.services.length >= 5);
  const withDoctor = r.data.services.find((s) => s.doctors.length > 0);
  assert.ok(withDoctor, 'at least one service must have a professional assigned');
  assert.equal(typeof withDoctor.price, 'number', 'Decimal must serialize as a number, not a string');
});

test('SVC-02 admin can create/update/delete a service; a plain agent cannot', async () => {
  const name = `Test service ${uniq()}`;
  const forbidden = await req('/services', { method: 'POST', token: agentToken, body: { name, durationMinutes: 30 } });
  assert.equal(forbidden.status, 403);

  const created = await req('/services', { method: 'POST', token: adminToken, body: { name, durationMinutes: 45, price: 1234.5 } });
  assert.equal(created.status, 201);
  const id = created.data.service.id;
  assert.equal(created.data.service.price, 1234.5);

  const upd = await req(`/services/${id}`, { method: 'PATCH', token: adminToken, body: { price: 999 } });
  assert.equal(upd.data.service.price, 999);

  const del = await req(`/services/${id}`, { method: 'DELETE', token: adminToken });
  assert.equal(del.status, 200);
});

test('SVC-03 rejects an invalid duration', async () => {
  const r = await req('/services', { method: 'POST', token: adminToken, body: { name: `bad ${uniq()}`, durationMinutes: 4000 } });
  assert.equal(r.status, 400);
});

// --------------------------- Public online booking ---------------------------

test('PUB-01 public endpoints need no authentication and expose no PHI', async () => {
  const r = await req('/public/services');
  assert.equal(r.status, 200);
  assert.ok(r.data.services.length > 0);
  const s = r.data.services[0];
  // Only booking-relevant fields — never customers, notes or internal records.
  assert.ok(!('customers' in s) && !('appointments' in s));
  for (const d of s.doctors) {
    assert.deepEqual(Object.keys(d).sort(), ['id', 'name', 'specialty'].sort());
  }
});

test('PUB-02 availability returns only free slots for a bookable day', async () => {
  const { data } = await req('/public/services');
  const svc = data.services.find((s) => s.doctors.length > 0);
  const date = ymd(futureWeekday());
  const r = await req(`/public/availability?serviceId=${svc.id}&doctorId=any&date=${date}`);
  assert.equal(r.status, 200);
  assert.ok(r.data.slots.length > 0, 'the seeded doctors work weekdays, so slots must exist');
  assert.ok(r.data.slots.every((s) => s.available === true));
  assert.ok(r.data.slots.every((s) => typeof s.doctorId === 'string'));
});

test('PUB-03 a patient can book online; it is stamped source=ONLINE with the service linked', async () => {
  const { data } = await req('/public/services');
  const svc = data.services.find((s) => s.doctors.length > 0);
  const date = ymd(futureWeekday(4));
  const av = await req(`/public/availability?serviceId=${svc.id}&doctorId=any&date=${date}`);
  const slot = av.data.slots[0];

  const phone = `+52155${uniq().slice(-8)}`;
  const booked = await req('/public/book', {
    method: 'POST',
    body: { serviceId: svc.id, doctorId: slot.doctorId, start: slot.start, name: 'Online Patient', phone, email: `p${uniq()}@example.com`, notes: 'Booked from the website' },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  assert.equal(booked.data.appointment.serviceName, svc.name);

  // Verify server-side that the booking is attributed correctly.
  const appts = await req(`/appointments?from=${date}&to=${nextDay(date)}`, { token: adminToken });
  const mine = appts.data.appointments.find((a) => a.id === booked.data.appointment.id);
  assert.ok(mine, 'the online booking must appear in the staff appointment list');
  assert.equal(mine.source, 'ONLINE');
  assert.equal(mine.serviceId, svc.id);
});

test('PUB-04 rejects bad input, past dates and off-grid times', async () => {
  const { data } = await req('/public/services');
  const svc = data.services.find((s) => s.doctors.length > 0);

  const noName = await req('/public/book', { method: 'POST', body: { serviceId: svc.id, start: new Date(Date.now() + 864e5).toISOString(), name: '', phone: '+5215500000000' } });
  assert.equal(noName.status, 400);

  const badPhone = await req('/public/book', { method: 'POST', body: { serviceId: svc.id, start: new Date(Date.now() + 864e5).toISOString(), name: 'Someone', phone: 'abc' } });
  assert.equal(badPhone.status, 400);

  const past = await req('/public/book', { method: 'POST', body: { serviceId: svc.id, start: new Date(Date.now() - 864e5).toISOString(), name: 'Someone', phone: '+5215500000000' } });
  assert.equal(past.status, 400);

  // 03:17 is outside every configured availability window => never a valid slot.
  const d = futureWeekday(5);
  d.setHours(3, 17, 0, 0);
  const offGrid = await req('/public/book', { method: 'POST', body: { serviceId: svc.id, start: d.toISOString(), name: 'Someone', phone: '+5215500000000' } });
  assert.ok([409, 400].includes(offGrid.status), `off-grid time must be refused, got ${offGrid.status}`);
});

test('PUB-05 SECURITY: an email alone never adopts an existing patient record', async () => {
  // Create a patient with a known email via an online booking.
  const { data } = await req('/public/services');
  const svc = data.services.find((s) => s.doctors.length > 0);
  const date = ymd(futureWeekday(6));
  const av = await req(`/public/availability?serviceId=${svc.id}&doctorId=any&date=${date}`);
  assert.ok(av.data.slots.length > 1, 'need at least two free slots for this test');

  const victimEmail = `victim${uniq()}@example.com`;
  const victimPhone = `+52155${uniq().slice(-8)}`;
  const first = await req('/public/book', {
    method: 'POST',
    body: { serviceId: svc.id, doctorId: av.data.slots[0].doctorId, start: av.data.slots[0].start, name: 'Victim Patient', phone: victimPhone, email: victimEmail },
  });
  assert.equal(first.status, 201);

  // An attacker who knows ONLY the email books with a different phone.
  const attacker = await req('/public/book', {
    method: 'POST',
    body: { serviceId: svc.id, doctorId: av.data.slots[1].doctorId, start: av.data.slots[1].start, name: 'Attacker', phone: `+52155${uniq().slice(-8)}`, email: victimEmail },
  });
  assert.equal(attacker.status, 201);

  // The two bookings must belong to DIFFERENT customer records.
  const list = await req(`/appointments?from=${date}&to=${nextDay(date)}`, { token: adminToken });
  const a1 = list.data.appointments.find((a) => a.id === first.data.appointment.id);
  const a2 = list.data.appointments.find((a) => a.id === attacker.data.appointment.id);
  assert.ok(a1 && a2);
  assert.notEqual(a1.customerId, a2.customerId, 'an unverified email must NOT merge into another patient record');
});

// --------------------------------- Calendar ----------------------------------

test('CAL-01 calendar returns appointments in a range with doctor/customer context', async () => {
  const from = ymd(new Date());
  const to = ymd(futureWeekday(10));
  const r = await req(`/calendar?from=${from}&to=${to}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.appointments));
  if (r.data.appointments.length) {
    const a = r.data.appointments[0];
    assert.ok(a.start && a.end && a.doctor && a.customer);
  }
});

test('CAL-02 rejects a range longer than the allowed window', async () => {
  const r = await req('/calendar?from=2026-01-01&to=2026-12-31', { token: adminToken });
  assert.equal(r.status, 400);
});

test('CAL-03 rescheduling onto an occupied slot is refused as a double booking', async () => {
  const date = futureWeekday(7);
  const dateStr = ymd(date);
  const { data } = await req('/public/services');
  const svc = data.services.find((s) => s.doctors.length > 0);
  const av = await req(`/public/availability?serviceId=${svc.id}&doctorId=${svc.doctors[0].id}&date=${dateStr}`);
  assert.ok(av.data.slots.length >= 2);

  const mk = async (slot) => {
    const r = await req('/public/book', {
      method: 'POST',
      body: { serviceId: svc.id, doctorId: svc.doctors[0].id, start: slot.start, name: 'Cal Test', phone: `+52155${uniq().slice(-8)}` },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.appointment;
  };
  const first = await mk(av.data.slots[0]);
  const second = await mk(av.data.slots[1]);

  // Move the second onto the first's start time — same doctor => conflict.
  const clash = await req(`/calendar/${second.id}/reschedule`, {
    method: 'PATCH',
    token: adminToken,
    body: { start: first.start },
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.error.details?.code || clash.data.error.code, 'DOUBLE_BOOKING');
});

test('CAL-04 appointment status can be set to COMPLETED / NO_SHOW', async () => {
  const dateStr = ymd(futureWeekday(8));
  const { data } = await req('/public/services');
  const svc = data.services.find((s) => s.doctors.length > 0);
  const av = await req(`/public/availability?serviceId=${svc.id}&doctorId=any&date=${dateStr}`);
  const b = await req('/public/book', {
    method: 'POST',
    body: { serviceId: svc.id, doctorId: av.data.slots[0].doctorId, start: av.data.slots[0].start, name: 'Status Test', phone: `+52155${uniq().slice(-8)}` },
  });
  const id = b.data.appointment.id;

  const done = await req(`/calendar/${id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'COMPLETED' } });
  assert.equal(done.status, 200);
  assert.equal(done.data.appointment.status, 'COMPLETED');

  const bad = await req(`/calendar/${id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'BANANA' } });
  assert.equal(bad.status, 400);
});

// ------------------------------ Inventory ------------------------------------

test('INV-01 stats and low-stock detection work on the seeded catalogue', async () => {
  const stats = await req('/inventory/stats', { token: adminToken });
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.data.stats.totalProducts, 'number');
  const low = await req('/inventory/low-stock', { token: adminToken });
  assert.ok(Array.isArray(low.data.products));
});

test('INV-02 stock movements: IN adds, OUT removes, OUT beyond stock is refused', async () => {
  const created = await req('/inventory/products', {
    method: 'POST', token: adminToken,
    body: { name: `Test product ${uniq()}`, price: 100, cost: 40, stock: 10, lowStockThreshold: 3 },
  });
  assert.equal(created.status, 201);
  const id = created.data.product.id;

  const added = await req('/inventory/stock/adjust', { method: 'POST', token: adminToken, body: { productId: id, type: 'IN', quantity: 5 } });
  assert.equal(added.data.product.stock, 15);

  const removed = await req('/inventory/stock/adjust', { method: 'POST', token: adminToken, body: { productId: id, type: 'OUT', quantity: 4 } });
  assert.equal(removed.data.product.stock, 11);

  const tooMany = await req('/inventory/stock/adjust', { method: 'POST', token: adminToken, body: { productId: id, type: 'OUT', quantity: 999 } });
  assert.equal(tooMany.status, 409, 'stock must never go negative');
});

test('INV-03 ADJUST can set a counted quantity of zero', async () => {
  const created = await req('/inventory/products', {
    method: 'POST', token: adminToken,
    body: { name: `Zeroable ${uniq()}`, price: 10, stock: 7 },
  });
  const id = created.data.product.id;
  const zeroed = await req('/inventory/stock/adjust', { method: 'POST', token: adminToken, body: { productId: id, type: 'ADJUST', quantity: 0, reason: 'counted empty' } });
  assert.equal(zeroed.status, 200, JSON.stringify(zeroed.data));
  assert.equal(zeroed.data.product.stock, 0);
});

// ------------------------- Payments / POS / commissions ----------------------

test('POS-01 a service sale computes totals and accrues a commission', async () => {
  const services = await req('/services', { token: adminToken });
  const svc = services.data.services.find((s) => s.doctors.length > 0 && s.price > 0);
  const doctorId = svc.doctors[0].id;

  const sale = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'SERVICE', serviceId: svc.id, doctorId, quantity: 1 }], method: 'CARD', discount: 0, tax: 0 },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  assert.equal(sale.data.payment.total, svc.price);
  assert.equal(sale.data.payment.status, 'PAID');
  assert.ok(sale.data.payment.receiptNumber > 0);

  const comms = await req(`/billing/commissions?doctorId=${doctorId}`, { token: adminToken });
  assert.ok(comms.data.commissions.length > 0, 'a commission must be recorded for the performing professional');
});

test('POS-02 a product sale decrements stock; overselling is refused and rolls back', async () => {
  const created = await req('/inventory/products', {
    method: 'POST', token: adminToken,
    body: { name: `POS product ${uniq()}`, price: 50, cost: 20, stock: 2 },
  });
  const productId = created.data.product.id;

  const sale = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'PRODUCT', productId, quantity: 2 }], method: 'CASH' },
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.data.payment.total, 100);

  const after = await req(`/inventory/products/${productId}`, { token: adminToken });
  assert.equal(after.data.product.stock, 0);

  const oversell = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'PRODUCT', productId, quantity: 1 }], method: 'CASH' },
  });
  assert.equal(oversell.status, 409, 'selling out-of-stock goods must fail');
});

test('POS-03 a discount greater than the subtotal is rejected', async () => {
  const services = await req('/services', { token: adminToken });
  const svc = services.data.services.find((s) => s.price > 0);
  const r = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'SERVICE', serviceId: svc.id, quantity: 1 }], method: 'CASH', discount: svc.price + 5000 },
  });
  assert.equal(r.status, 400);
});

test('POS-04 a refund restores product stock and is not repeatable', async () => {
  const created = await req('/inventory/products', {
    method: 'POST', token: adminToken,
    body: { name: `Refundable ${uniq()}`, price: 30, stock: 5 },
  });
  const productId = created.data.product.id;
  const sale = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'PRODUCT', productId, quantity: 3 }], method: 'CASH' },
  });
  const paymentId = sale.data.payment.id;
  assert.equal((await req(`/inventory/products/${productId}`, { token: adminToken })).data.product.stock, 2);

  const refund = await req(`/billing/payments/${paymentId}/refund`, { method: 'POST', token: adminToken, body: { reason: 'test' } });
  assert.equal(refund.status, 200);
  assert.equal((await req(`/inventory/products/${productId}`, { token: adminToken })).data.product.stock, 5);

  const again = await req(`/billing/payments/${paymentId}/refund`, { method: 'POST', token: adminToken, body: { reason: 'test' } });
  assert.equal(again.status, 409, 'a payment must not be refundable twice');
});

test('POS-05 a receipt is printable and a payment link is publicly viewable', async () => {
  const services = await req('/services', { token: adminToken });
  const svc = services.data.services.find((s) => s.price > 0);
  const sale = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'SERVICE', serviceId: svc.id, quantity: 1 }], method: 'CASH' },
  });
  const receipt = await req(`/billing/payments/${sale.data.payment.id}/receipt`, { token: adminToken });
  assert.equal(receipt.status, 200);
  assert.ok(receipt.data.receipt.receiptNumber > 0);

  const link = await req('/billing/links', { method: 'POST', token: adminToken, body: { amount: 250, description: 'Consultation deposit' } });
  assert.equal(link.status, 201);
  const token = link.data.payment.publicToken;
  assert.ok(token, 'a payment link must expose a public token');

  // Public read requires NO auth and must not leak internal ids.
  const pub = await req(`/billing/link/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.link.amount, 250);
  assert.ok(!('customerId' in pub.data.link) && !('id' in pub.data.link), 'the public link view must not expose internal ids');

  const confirm = await req(`/billing/link/${token}/confirm`, { method: 'POST', body: { reference: 'TEST-REF' } });
  assert.equal(confirm.status, 200);
  const twice = await req(`/billing/link/${token}/confirm`, { method: 'POST', body: {} });
  assert.equal(twice.status, 409, 'a link must not be payable twice');
});

test('POS-06 the cash register opens once, records movements and closes with a difference', async () => {
  const open = await req('/billing/cash/open', { method: 'POST', token: adminToken, body: { openingFloat: 500 } });
  assert.ok([200, 201, 409].includes(open.status));
  if (open.status === 409) {
    await req('/billing/cash/close', { method: 'POST', token: adminToken, body: { closingCount: 0, notes: 'test cleanup' } });
    const reopen = await req('/billing/cash/open', { method: 'POST', token: adminToken, body: { openingFloat: 500 } });
    assert.ok([200, 201].includes(reopen.status));
  }

  const dup = await req('/billing/cash/open', { method: 'POST', token: adminToken, body: { openingFloat: 100 } });
  assert.equal(dup.status, 409, 'only one register session may be open at a time');

  await req('/billing/cash/movement', { method: 'POST', token: adminToken, body: { type: 'CASH_IN', amount: 100, reason: 'float top-up' } });
  const closed = await req('/billing/cash/close', { method: 'POST', token: adminToken, body: { closingCount: 550, notes: 'end of test' } });
  assert.equal(closed.status, 200);
  assert.equal(typeof closed.data.session.difference, 'number');
});

// -------------------------------- Marketing ----------------------------------

test('MKT-01 gift card: issue, redeem, and refuse over-redemption', async () => {
  const created = await req('/marketing/giftcards', { method: 'POST', token: adminToken, body: { amount: 500, note: 'test card' } });
  assert.equal(created.status, 201);
  const code = created.data.giftCard.code;
  assert.equal(created.data.giftCard.balance, 500);

  const r1 = await req('/marketing/giftcards/redeem', { method: 'POST', token: adminToken, body: { code, amount: 200 } });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.giftCard.balance, 300);

  const tooMuch = await req('/marketing/giftcards/redeem', { method: 'POST', token: adminToken, body: { code, amount: 5000 } });
  assert.equal(tooMuch.status, 409, 'a gift card must not go below zero');

  const rest = await req('/marketing/giftcards/redeem', { method: 'POST', token: adminToken, body: { code, amount: 300 } });
  assert.equal(rest.data.giftCard.balance, 0);
  assert.equal(rest.data.giftCard.status, 'REDEEMED');
});

test('MKT-02 paying with a gift card actually debits the card', async () => {
  const services = await req('/services', { token: adminToken });
  const svc = services.data.services.find((s) => s.price > 0);
  const card = await req('/marketing/giftcards', { method: 'POST', token: adminToken, body: { amount: svc.price + 100 } });
  const code = card.data.giftCard.code;

  const sale = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'SERVICE', serviceId: svc.id, quantity: 1 }], method: 'GIFT_CARD', giftCardCode: code },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));

  const after = await req(`/marketing/giftcards/code/${code}`, { token: adminToken });
  assert.equal(after.data.giftCard.balance, 100, 'the gift card balance must drop by the sale total');
});

test('MKT-03 paying with a gift card without funds fails and books no payment', async () => {
  const services = await req('/services', { token: adminToken });
  const svc = services.data.services.find((s) => s.price > 0);
  const card = await req('/marketing/giftcards', { method: 'POST', token: adminToken, body: { amount: 1 } });
  const code = card.data.giftCard.code;

  const sale = await req('/billing/payments', {
    method: 'POST', token: adminToken,
    body: { items: [{ kind: 'SERVICE', serviceId: svc.id, quantity: 1 }], method: 'GIFT_CARD', giftCardCode: code },
  });
  assert.equal(sale.status, 409, 'an underfunded gift card must not complete a sale');

  const after = await req(`/marketing/giftcards/code/${code}`, { token: adminToken });
  assert.equal(after.data.giftCard.balance, 1, 'the failed sale must roll back cleanly');
});

test('MKT-04 loyalty points are earned, redeemed, and cannot go negative', async () => {
  const customers = await req('/customers', { token: adminToken });
  const customerId = customers.data.customers[0].id;

  await req('/marketing/loyalty/earn', { method: 'POST', token: adminToken, body: { customerId, points: 300, reason: 'test earn' } });
  const acct = await req(`/marketing/loyalty/${customerId}`, { token: adminToken });
  assert.ok(acct.data.account.points >= 300);

  const over = await req('/marketing/loyalty/redeem', { method: 'POST', token: adminToken, body: { customerId, points: 999999, reason: 'too many' } });
  assert.equal(over.status, 409);

  const ok = await req('/marketing/loyalty/redeem', { method: 'POST', token: adminToken, body: { customerId, points: 100, reason: 'test redeem' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.account.points >= 0);
});

test('MKT-05 survey: invite, public answer, and no double submission', async () => {
  const customers = await req('/customers', { token: adminToken });
  const customerId = customers.data.customers[0].id;
  const invite = await req('/marketing/surveys/invite', { method: 'POST', token: adminToken, body: { customerId } });
  assert.equal(invite.status, 200);
  const token = invite.data.invite.token;

  // Public read — no auth, and no PHI.
  const pub = await req(`/marketing/survey/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.survey.answered, false);
  assert.ok(!('customerId' in pub.data.survey));

  const sent = await req(`/marketing/survey/${token}`, { method: 'POST', body: { rating: 5, comment: 'Great service' } });
  assert.equal(sent.status, 200);

  const again = await req(`/marketing/survey/${token}`, { method: 'POST', body: { rating: 1 } });
  assert.equal(again.status, 409, 'a survey must only be answerable once');

  const bad = await req('/marketing/surveys/invite', { method: 'POST', token: adminToken, body: { customerId } });
  const badRating = await req(`/marketing/survey/${bad.data.invite.token}`, { method: 'POST', body: { rating: 9 } });
  assert.equal(badRating.status, 400);
});

test('MKT-06 §9A: a WhatsApp campaign requires an approved template', async () => {
  const c = await req('/marketing/campaigns', {
    method: 'POST', token: adminToken,
    body: { name: `WA campaign ${uniq()}`, channel: 'WHATSAPP', body: 'Hello', templateName: 'reengage_followup' },
  });
  assert.equal(c.status, 201);
  const sent = await req(`/marketing/campaigns/${c.data.campaign.id}/send`, { method: 'POST', token: adminToken });
  // reengage_followup is seeded as PENDING (not approved) => every recipient is skipped.
  assert.equal(sent.data.sent, 0, 'an unapproved template must never be delivered');
});

// ---------------------------- Clinical records (EHR) -------------------------

test('CLIN-01 a structured clinical record can be created and listed', async () => {
  const customers = await req('/customers', { token: adminToken });
  const customerId = customers.data.customers[0].id;
  const created = await req('/clinical', {
    method: 'POST', token: adminToken,
    body: {
      customerId,
      reason: 'Annual skin check',
      diagnosis: 'Benign nevus',
      treatment: 'Observation',
      vitals: { bloodPressure: '120/80', heartRate: 68 },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.record.diagnosis, 'Benign nevus');

  const list = await req(`/clinical?customerId=${customerId}`, { token: adminToken });
  assert.ok(list.data.records.some((r) => r.id === created.data.record.id));
  // A list must never carry attachment bytes.
  for (const r of list.data.records) for (const a of r.attachments || []) assert.ok(!('data' in a));
});

test('CLIN-02 attachments enforce the mime allowlist', async () => {
  const customers = await req('/customers', { token: adminToken });
  const rec = await req('/clinical', { method: 'POST', token: adminToken, body: { customerId: customers.data.customers[0].id, reason: 'Attachment test' } });
  const id = rec.data.record.id;

  const ok = await req(`/clinical/${id}/attachments`, {
    method: 'POST', token: adminToken,
    body: { filename: 'note.txt', mimeType: 'text/plain', base64: Buffer.from('hello clinic').toString('base64') },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));

  const banned = await req(`/clinical/${id}/attachments`, {
    method: 'POST', token: adminToken,
    body: { filename: 'evil.exe', mimeType: 'application/x-msdownload', base64: Buffer.from('MZ').toString('base64') },
  });
  assert.equal(banned.status, 400, 'executables must be rejected');
});

// --------------------------------- Reminders ---------------------------------

test('REM-01 reminder config can be read and updated with validation', async () => {
  const get = await req('/reminders/config', { token: adminToken });
  assert.equal(get.status, 200);
  assert.ok(Array.isArray(get.data.config.offsetsHours));

  const upd = await req('/reminders/config', { method: 'PUT', token: adminToken, body: { offsetsHours: [24, 48], channels: ['WHATSAPP', 'EMAIL'] } });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.data.config.offsetsHours, [24, 48]);

  const bad = await req('/reminders/config', { method: 'PUT', token: adminToken, body: { channels: ['CARRIER_PIGEON'] } });
  assert.equal(bad.status, 400);

  const badOffset = await req('/reminders/config', { method: 'PUT', token: adminToken, body: { offsetsHours: [99999] } });
  assert.equal(badOffset.status, 400);
});

test('REM-02 a manual sweep runs and reports counters', async () => {
  const r = await req('/reminders/run', { method: 'POST', token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(typeof r.data.checked, 'number');
  assert.equal(typeof r.data.sent, 'number');
});

// ------------------------------ Business reports -----------------------------

test('RPT-01 financial, attendance, commission and overview reports return sane shapes', async () => {
  const from = ymd(new Date(Date.now() - 30 * 864e5));
  const to = ymd(new Date(Date.now() + 864e5));

  const fin = await req(`/reports-business/financial?from=${from}&to=${to}`, { token: adminToken });
  assert.equal(fin.status, 200);
  assert.equal(typeof fin.data.totals.gross, 'number');
  assert.ok(Number.isFinite(fin.data.totals.averageTicket), 'averageTicket must never be NaN');
  assert.ok(Array.isArray(fin.data.byMethod) && Array.isArray(fin.data.byDay));

  const att = await req(`/reports-business/attendance?from=${from}&to=${to}`, { token: adminToken });
  assert.equal(typeof att.data.totals.noShowRate, 'number');
  assert.ok(Array.isArray(att.data.byDoctor));

  const com = await req(`/reports-business/commissions?from=${from}&to=${to}`, { token: adminToken });
  assert.equal(typeof com.data.totals.total, 'number');

  const ov = await req(`/reports-business/overview?from=${from}&to=${to}`, { token: adminToken });
  assert.equal(typeof ov.data.revenue, 'number');
  assert.equal(typeof ov.data.noShowRate, 'number');
});

test('RPT-02 business reports are admin-only', async () => {
  const r = await req('/reports-business/financial', { token: agentToken });
  assert.equal(r.status, 403);
});

test('RPT-03 an empty range returns zeros, never NaN or null', async () => {
  const r = await req('/reports-business/financial?from=2020-01-01&to=2020-01-02', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.gross, 0);
  assert.equal(r.data.totals.transactions, 0);
  assert.equal(r.data.totals.averageTicket, 0);
});
