import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { scanOnce } from '../services/redflag/scanner.js';

export const redflagRouter = Router();
redflagRouter.use(requireAuth, requireRole('ADMIN'));

// Manual "scan now" — flags any conversations already over the threshold.
// Useful for the Admin UI and for deterministic testing.
redflagRouter.post(
  '/scan',
  asyncHandler(async (req, res) => {
    res.json(await scanOnce());
  }),
);
