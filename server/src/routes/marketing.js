// Marketing API — campaigns, loyalty, gift cards and satisfaction surveys.
// The two /survey/:token routes are PUBLIC (a patient opens them from a link),
// so they are declared BEFORE marketingRouter.use(requireAuth) and are IP
// rate-limited. Everything below the requireAuth line needs a signed-in agent;
// campaign mutations are ADMIN-only.
import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { rateLimit } from '../middleware/security.js';
import * as marketing from '../services/marketing/service.js';

export const marketingRouter = Router();

// ---------------------------- PUBLIC survey routes ---------------------------
// The shared limiter namespaces its bucket by `name`, so reads and submissions
// get SEPARATE budgets — otherwise reloading the survey page would burn the
// submit allowance (and everyone behind one clinic IP would share it).
const SURVEY_WINDOW_MS = 10 * 60 * 1000;

marketingRouter.get(
  '/survey/:token',
  rateLimit({ name: 'survey-read', max: 60, windowMs: SURVEY_WINDOW_MS }),
  asyncHandler(async (req, res) => {
    res.json({ survey: await marketing.getSurveyByToken(req.params.token) });
  }),
);

marketingRouter.post(
  '/survey/:token',
  rateLimit({ name: 'survey-write', max: 20, windowMs: SURVEY_WINDOW_MS }),
  asyncHandler(async (req, res) => {
    res.json(await marketing.submitSurvey(req.params.token, req.body || {}));
  }),
);

// ------------------------------ AUTHENTICATED --------------------------------

marketingRouter.use(requireAuth);

// --- Campaigns ---------------------------------------------------------------

marketingRouter.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    res.json({ campaigns: await marketing.listCampaigns() });
  }),
);

marketingRouter.post(
  '/campaigns',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const campaign = await marketing.createCampaign({ ...(req.body || {}), createdByAgentId: req.agent.id });
    res.status(201).json({ campaign });
  }),
);

marketingRouter.get(
  '/campaigns/:id',
  asyncHandler(async (req, res) => {
    res.json({ campaign: await marketing.getCampaign(req.params.id) });
  }),
);

marketingRouter.patch(
  '/campaigns/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ campaign: await marketing.updateCampaign(req.params.id, req.body || {}) });
  }),
);

marketingRouter.delete(
  '/campaigns/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await marketing.deleteCampaign(req.params.id));
  }),
);

marketingRouter.post(
  '/campaigns/:id/send',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await marketing.sendCampaign(req.params.id));
  }),
);

marketingRouter.post(
  '/audience/preview',
  asyncHandler(async (req, res) => {
    res.json(await marketing.previewAudience(req.body || {}));
  }),
);

// --- Loyalty -----------------------------------------------------------------

marketingRouter.get(
  '/loyalty/:customerId',
  asyncHandler(async (req, res) => {
    res.json(await marketing.getLoyalty(req.params.customerId));
  }),
);

marketingRouter.post(
  '/loyalty/earn',
  asyncHandler(async (req, res) => {
    res.json(await marketing.earnPoints(req.body || {}));
  }),
);

marketingRouter.post(
  '/loyalty/redeem',
  asyncHandler(async (req, res) => {
    res.json(await marketing.redeemPoints(req.body || {}));
  }),
);

marketingRouter.get(
  '/loyalty',
  asyncHandler(async (req, res) => {
    res.json({ leaderboard: await marketing.loyaltyLeaderboard(req.query.limit) });
  }),
);

// --- Gift cards --------------------------------------------------------------

marketingRouter.get(
  '/giftcards',
  asyncHandler(async (req, res) => {
    res.json({ giftCards: await marketing.listGiftCards({ status: req.query.status }) });
  }),
);

marketingRouter.post(
  '/giftcards',
  asyncHandler(async (req, res) => {
    res.status(201).json({ giftCard: await marketing.createGiftCard(req.body || {}) });
  }),
);

marketingRouter.get(
  '/giftcards/code/:code',
  asyncHandler(async (req, res) => {
    res.json({ giftCard: await marketing.getGiftCardByCode(req.params.code) });
  }),
);

marketingRouter.post(
  '/giftcards/redeem',
  asyncHandler(async (req, res) => {
    res.json(await marketing.redeemGiftCard(req.body || {}));
  }),
);

marketingRouter.post(
  '/giftcards/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json({ giftCard: await marketing.cancelGiftCard(req.params.id) });
  }),
);

// --- Surveys -----------------------------------------------------------------

marketingRouter.get(
  '/surveys/stats',
  asyncHandler(async (req, res) => {
    res.json({ stats: await marketing.surveyStats() });
  }),
);

marketingRouter.get(
  '/surveys',
  asyncHandler(async (req, res) => {
    res.json({ responses: await marketing.listSurveyResponses({ limit: req.query.limit }) });
  }),
);

marketingRouter.post(
  '/surveys/invite',
  asyncHandler(async (req, res) => {
    res.json({ invite: await marketing.createSurveyInvite(req.body || {}) });
  }),
);
