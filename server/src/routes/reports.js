import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import * as reporting from '../services/reporting/service.js';

export const reportsRouter = Router();
// §4 roles matrix: reporting dashboard assumed Admin-only (flagged in §13).
reportsRouter.use(requireAuth, requireRole('ADMIN'));

reportsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    res.json(await reporting.overview({ from: req.query.from, to: req.query.to }));
  }),
);

reportsRouter.get(
  '/message-volume',
  asyncHandler(async (req, res) => {
    res.json({ series: await reporting.messageVolumeSeries({ from: req.query.from, to: req.query.to }) });
  }),
);
