// SMS provider for reminders / notifications. Dependency-free: posts to the
// Twilio REST API with global fetch + Basic auth when the credentials are set,
// otherwise DRY-RUN. Never throws — mirrors the email provider's result shape.
import { createLogger } from '../../lib/logger.js';

const log = createLogger('sms');

export function smsConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM
  );
}

export async function sendSms({ to, body }) {
  if (!to || !String(to).trim()) return { ok: false, error: 'No recipient phone number' };
  if (!body || !String(body).trim()) return { ok: false, error: 'SMS body is empty' };

  if (!smsConfigured()) {
    log.info('DRY-RUN sms', { to });
    return { ok: true, dryRun: true };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const form = new URLSearchParams({ To: String(to), From: process.env.TWILIO_FROM, Body: String(body) });

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data?.message || `Twilio responded ${res.status}`;
      log.error('SMS send failed', { to, status: res.status, error });
      return { ok: false, error };
    }
    return { ok: true, id: data?.sid || null };
  } catch (err) {
    log.error('SMS send threw', { to, error: err.message });
    return { ok: false, error: err.message };
  }
}
