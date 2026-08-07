// Payments / POS API. The two /link routes are PUBLIC — the customer opening a
// payment link is not logged in — so they are registered BEFORE requireAuth and
// no authenticated route uses the '/link' prefix (link creation is POST /links).
import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { rateLimit } from '../middleware/security.js';
import {
  createPayment,
  listPayments,
  getPayment,
  refundPayment,
  receiptData,
  createPaymentLink,
  getPaymentByToken,
  markLinkPaid,
  openCashSession,
  getOpenSession,
  addCashMovement,
  closeCashSession,
  listCashSessions,
  listCommissions,
  payCommissions,
} from '../services/billing/service.js';

export const billingRouter = Router();

// ------------------------------ public (no auth) -----------------------------

// Both are reachable by anyone on the internet, so they are throttled per IP:
// the read to stop token-grinding, the confirm (a state change) far tighter.
const PUBLIC_WINDOW_MS = 10 * 60 * 1000;

billingRouter.get(
  '/link/:token',
  rateLimit({ name: 'pay-link-read', max: 60, windowMs: PUBLIC_WINDOW_MS }),
  asyncHandler(async (req, res) => {
    res.json({ link: await getPaymentByToken(req.params.token) });
  }),
);

billingRouter.post(
  '/link/:token/confirm',
  rateLimit({ name: 'pay-link-confirm', max: 10, windowMs: PUBLIC_WINDOW_MS }),
  asyncHandler(async (req, res) => {
    res.json({ link: await markLinkPaid(req.params.token, req.body || {}) });
  }),
);

// ----------------------------- authenticated API -----------------------------

billingRouter.use(requireAuth);

billingRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    res.json(await listPayments(req.query || {}));
  }),
);

billingRouter.post(
  '/payments',
  asyncHandler(async (req, res) => {
    res.status(201).json({ payment: await createPayment({ ...(req.body || {}), agent: req.agent }) });
  }),
);

billingRouter.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    res.json({ payment: await getPayment(req.params.id) });
  }),
);

billingRouter.post(
  '/payments/:id/refund',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { reason } = req.body || {};
    res.json({ payment: await refundPayment(req.params.id, { reason, agent: req.agent }) });
  }),
);

billingRouter.get(
  '/payments/:id/receipt',
  asyncHandler(async (req, res) => {
    res.json({ receipt: await receiptData(req.params.id) });
  }),
);

billingRouter.post(
  '/links',
  asyncHandler(async (req, res) => {
    res.status(201).json({ payment: await createPaymentLink(req.body || {}) });
  }),
);

billingRouter.get(
  '/cash/open',
  asyncHandler(async (req, res) => {
    res.json({ session: await getOpenSession() });
  }),
);

billingRouter.post(
  '/cash/open',
  asyncHandler(async (req, res) => {
    const { openingFloat } = req.body || {};
    res.status(201).json({ session: await openCashSession({ openingFloat, agent: req.agent }) });
  }),
);

billingRouter.post(
  '/cash/movement',
  asyncHandler(async (req, res) => {
    const { type, amount, reason } = req.body || {};
    res.json({ session: await addCashMovement({ type, amount, reason, agent: req.agent }) });
  }),
);

billingRouter.post(
  '/cash/close',
  asyncHandler(async (req, res) => {
    const { closingCount, notes } = req.body || {};
    res.json({ session: await closeCashSession({ closingCount, notes, agent: req.agent }) });
  }),
);

billingRouter.get(
  '/cash/sessions',
  asyncHandler(async (req, res) => {
    res.json({ sessions: await listCashSessions({ limit: req.query.limit }) });
  }),
);

billingRouter.get(
  '/commissions',
  asyncHandler(async (req, res) => {
    const { doctorId, status, from, to } = req.query || {};
    res.json(await listCommissions({ doctorId, status, from, to }));
  }),
);

billingRouter.post(
  '/commissions/pay',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await payCommissions(req.body || {}));
  }),
);
