// Email provider for reminders / notifications. Dependency-free: talks to the
// Resend HTTP API with global fetch when RESEND_API_KEY is set, otherwise falls
// back to DRY-RUN (logs the email) so the app is fully testable without secrets.
// Never throws — callers log the returned result instead of crashing a cron tick.
import { createLogger } from '../../lib/logger.js';

const log = createLogger('email');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Clinic <onboarding@resend.dev>';

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail({ to, subject, html, text }) {
  if (!to || !String(to).trim()) return { ok: false, error: 'No recipient email address' };
  if (!html && !text) return { ok: false, error: 'Email has no body' };

  if (!emailConfigured()) {
    log.info('DRY-RUN email', { to, subject });
    return { ok: true, dryRun: true };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to,
        subject: subject || '(no subject)',
        html: html || `<p>${String(text).replace(/\n/g, '<br>')}</p>`,
        ...(text ? { text } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data?.message || data?.error?.message || `Resend responded ${res.status}`;
      log.error('Email send failed', { to, status: res.status, error });
      return { ok: false, error };
    }
    return { ok: true, id: data?.id || null };
  } catch (err) {
    log.error('Email send threw', { to, error: err.message });
    return { ok: false, error: err.message };
  }
}
