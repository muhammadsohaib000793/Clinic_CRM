import { Router } from 'express';
import { asyncHandler, ValidationError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { getAllSettings, setSetting, getRedflagThresholdMinutes } from '../services/settings/service.js';
import { SETTING_KEYS } from '../config/constants.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      settings: await getAllSettings(),
      redflagThresholdMinutes: await getRedflagThresholdMinutes(),
    });
  }),
);

// Configure the red-flag threshold (§13 open question: who configures -> Admin).
settingsRouter.put(
  '/redflag-threshold',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const minutes = Number(req.body?.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new ValidationError('minutes must be a positive number');
    }
    await setSetting(SETTING_KEYS.REDFLAG_THRESHOLD_MINUTES, minutes);
    res.json({ redflagThresholdMinutes: await getRedflagThresholdMinutes() });
  }),
);
