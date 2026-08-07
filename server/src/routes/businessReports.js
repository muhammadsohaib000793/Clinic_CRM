// Admin-only business reporting endpoints (financial, attendance, commissions,
// KPI overview). Runs parallel to /reports, which covers messaging metrics.
import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  financialReport,
  attendanceReport,
  commissionReport,
  clinicOverview,
} from '../services/reports/business.js';

export const businessReportsRouter = Router();
businessReportsRouter.use(requireAuth, requireRole('ADMIN'));

businessReportsRouter.get(
  '/financial',
  asyncHandler(async (req, res) => {
    res.json(await financialReport({ from: req.query.from, to: req.query.to }));
  }),
);

businessReportsRouter.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    res.json(await attendanceReport({ from: req.query.from, to: req.query.to }));
  }),
);

businessReportsRouter.get(
  '/commissions',
  asyncHandler(async (req, res) => {
    res.json(
      await commissionReport({ from: req.query.from, to: req.query.to, doctorId: req.query.doctorId }),
    );
  }),
);

businessReportsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    res.json(await clinicOverview({ from: req.query.from, to: req.query.to }));
  }),
);
