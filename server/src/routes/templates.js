import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { listTemplates } from '../services/messaging/templates.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ templates: await listTemplates() });
  }),
);
