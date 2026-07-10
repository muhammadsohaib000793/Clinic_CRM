import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import * as agents from '../services/agents/service.js';

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

// Any authenticated user can read the roster (needed for assignment dropdowns).
agentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ agents: await agents.listAgents() });
  }),
);

// Mutations are Admin-only (§4 roles matrix).
agentsRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ agent: await agents.createAgent(req.body || {}) });
  }),
);

agentsRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ agent: await agents.updateAgent(req.params.id, req.body || {}) });
  }),
);

agentsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await agents.deleteAgent(req.params.id));
  }),
);
