import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from '../services/messaging/templates.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ templates: await listTemplates() });
  }),
);

templatesRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ template: await createTemplate(req.body || {}) });
  }),
);

templatesRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ template: await updateTemplate(req.params.id, req.body || {}) });
  }),
);

templatesRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await deleteTemplate(req.params.id));
  }),
);
