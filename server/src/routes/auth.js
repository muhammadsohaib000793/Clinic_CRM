import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { login } from '../services/auth/service.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    res.json(await login(email, password));
  }),
);

authRouter.get('/me', requireAuth, (req, res) => res.json({ agent: req.agent }));
