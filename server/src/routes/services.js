import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
} from '../services/catalog/service.js';

export const servicesRouter = Router();
servicesRouter.use(requireAuth);

servicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      services: await listServices({
        activeOnly: req.query.activeOnly,
        bookableOnline: req.query.bookableOnline,
      }),
    });
  }),
);

servicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ service: await getService(req.params.id) });
  }),
);

servicesRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ service: await createService(req.body || {}) });
  }),
);

servicesRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ service: await updateService(req.params.id, req.body || {}) });
  }),
);

servicesRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await deleteService(req.params.id));
  }),
);
