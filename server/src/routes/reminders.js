import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  getReminderConfig,
  setReminderConfig,
  runReminderSweep,
  listReminderLogs,
} from '../services/reminders/scheduler.js';
import { emailConfigured } from '../services/notify/email.js';
import { smsConfigured } from '../services/notify/sms.js';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

remindersRouter.get(
  '/config',
  asyncHandler(async (req, res) => {
    res.json({
      config: await getReminderConfig(),
      providers: { email: emailConfigured(), sms: smsConfigured() },
    });
  }),
);

remindersRouter.put(
  '/config',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ config: await setReminderConfig(req.body || {}) });
  }),
);

// Manual sweep — lets an admin fire due reminders immediately (and test the setup).
remindersRouter.post(
  '/run',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await runReminderSweep());
  }),
);

remindersRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    res.json({ logs: await listReminderLogs(100) });
  }),
);
