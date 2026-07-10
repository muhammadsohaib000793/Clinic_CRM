// Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with
// the App Secret). If no App Secret is configured (dev/dry-run before secrets
// are pasted in), verification is skipped so the webhook is testable locally.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function verifySignature(req) {
  if (!env.meta.appSecret) {
    return { ok: true, skipped: true, reason: 'no_app_secret_dev_mode' };
  }
  const header = req.get('x-hub-signature-256') || '';
  if (!header.startsWith('sha256=')) return { ok: false, reason: 'missing_signature' };

  const provided = header.slice('sha256='.length);
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha256', env.meta.appSecret).update(raw).digest('hex');

  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'length_mismatch' };
    return { ok: crypto.timingSafeEqual(a, b), reason: 'checked' };
  } catch {
    return { ok: false, reason: 'compare_error' };
  }
}
