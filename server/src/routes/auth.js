import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { login } from '../services/auth/service.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';

export const authRouter = Router();

// Throttle login attempts per IP to slow brute-forcing.
const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 100, name: 'login' });

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    res.json(await login(email, password));
  }),
);

authRouter.get('/me', requireAuth, (req, res) => res.json({ agent: req.agent }));
