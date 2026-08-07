// PUBLIC, UNAUTHENTICATED routes for the 24/7 self-service booking page.
// Deliberately no requireAuth anywhere in this file. Every handler is IP
// rate-limited (fixed window, in-memory — same style as middleware/security.js)
// and all input validation/sanitisation lives in the booking service.
import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { publicServices, publicAvailability, publicBook } from '../services/booking/publicBooking.js';

export const publicRouter = Router();

const WINDOW_MS = 10 * 60 * 1000;
const buckets = new Map(); // "name:ip" -> { count, resetAt }

function publicRateLimit({ max, name }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, b);
    }
    b.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: `Too many requests — please try again in ${retry}s.` },
      });
    }
    return next();
  };
}

// Evict expired buckets so the Map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, WINDOW_MS).unref();

const readLimit = publicRateLimit({ max: 120, name: 'public-read' });
const bookLimit = publicRateLimit({ max: 20, name: 'public-book' });

// Public clinic card shown at the top of the booking page.
const CLINIC = Object.freeze({
  name: 'WeEvolveit',
  tagline: 'Book your appointment online — 24/7',
  phone: '+1 (555) 010-0100',
  email: 'hello@weevolveit.com',
  address: '123 Wellness Ave, Suite 200',
  hours: 'Mon–Fri, 9:00–13:00 and 14:00–18:00',
  bookingWindowDays: 180,
  currency: 'USD',
});

publicRouter.get('/clinic', readLimit, (req, res) => {
  res.json({ clinic: CLINIC });
});

publicRouter.get(
  '/services',
  readLimit,
  asyncHandler(async (req, res) => {
    res.json({ services: await publicServices() });
  }),
);

publicRouter.get(
  '/availability',
  readLimit,
  asyncHandler(async (req, res) => {
    const { serviceId, doctorId, date } = req.query || {};
    res.json(await publicAvailability({ serviceId, doctorId, date }));
  }),
);

publicRouter.post(
  '/book',
  bookLimit,
  asyncHandler(async (req, res) => {
    const { serviceId, doctorId, start, name, phone, email, notes } = req.body || {};
    const appointment = await publicBook({ serviceId, doctorId, start, name, phone, email, notes });
    res.status(201).json({ appointment });
  }),
);
