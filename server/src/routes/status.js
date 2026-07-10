import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { channelDryRunStatus, instagramHourlyUsage } from '../services/messaging/index.js';
import { currentProvider } from '../services/ai/index.js';
import { getRedflagThresholdMinutes } from '../services/settings/service.js';

export const statusRouter = Router();
statusRouter.use(requireAuth);

// Operational status for the UI banner: which channels are live vs dry-run,
// AI provider, IG rate-limit headroom, red-flag threshold.
statusRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      channels: channelDryRunStatus(), // { WHATSAPP: true|false(dryRun), ... }
      aiProvider: currentProvider(),
      redflagThresholdMinutes: await getRedflagThresholdMinutes(),
      instagram: await instagramHourlyUsage(),
    });
  }),
);
