import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { listAudit } from '../services/audit/service.js';

export const auditRouter = Router();
// PHI access log is Admin-only.
auditRouter.use(requireAuth, requireRole('ADMIN'));

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ entries: await listAudit({ limit: req.query.limit, customerId: req.query.customerId }) });
  }),
);
