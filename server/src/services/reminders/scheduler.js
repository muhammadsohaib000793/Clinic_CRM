// =============================================================================
//  Scheduled appointment-reminder engine.
// -----------------------------------------------------------------------------
//  Every 5 minutes it looks for CONFIRMED appointments that are exactly N hours
//  away (N = each configured offset) and sends a reminder on each configured
//  channel. A 15-minute catch-up band means a missed tick still fires, and the
//  ReminderLog @@unique([appointmentId, offsetHours, channel]) constraint is the
//  idempotency guard — a P2002 means "already sent", never a double send.
//
//  §9A: WhatsApp reminders are business-initiated and normally OUTSIDE the 24h
//  customer-service window, so they MUST go through sendGuard.send() with an
//  APPROVED template. This module never calls a channel sender directly.
//  Email and SMS are outside Meta's rules and are sent through their providers.
// =============================================================================
import cron from 'node-cron';
import { prisma } from '../../db/prisma.js';
import { getSetting, setSetting } from '../settings/service.js';
import * as sendGuard from '../messaging/sendGuard.js';
import { sendEmail } from '../notify/email.js';
import { sendSms } from '../notify/sms.js';
import { emitAll } from '../../realtime/emitter.js';
import { ValidationError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('reminders');

const KEYS = Object.freeze({
  OFFSETS: 'reminder.offsetsHours',
  CHANNELS: 'reminder.channels',
  TEMPLATE: 'reminder.templateName',
  ENABLED: 'reminder.enabled',
});

export const REMINDER_CHANNELS = Object.freeze(['WHATSAPP', 'EMAIL', 'SMS']);

const DEFAULTS = Object.freeze({
  offsetsHours: [24],
  channels: ['WHATSAPP'],
  templateName: 'appointment_reminder',
  enabled: true,
});

const CATCH_UP_MS = 15 * 60 * 1000; // window width: [t, t+15m)
const HOUR_MS = 60 * 60 * 1000;
const MAX_OFFSETS = 5;
const MIN_OFFSET_HOURS = 1;
const MAX_OFFSET_HOURS = 168; // one week

// ------------------------------- configuration -------------------------------

function parseArray(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cleanOffsets(list) {
  const out = [];
  for (const v of list) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < MIN_OFFSET_HOURS || n > MAX_OFFSET_HOURS) return null;
    if (!out.includes(n)) out.push(n);
  }
  if (out.length === 0 || out.length > MAX_OFFSETS) return null;
  return out.sort((a, b) => a - b);
}

function cleanChannels(list) {
  const out = [];
  for (const v of list) {
    const c = String(v).toUpperCase();
    if (!REMINDER_CHANNELS.includes(c)) return null;
    if (!out.includes(c)) out.push(c);
  }
  return out.length ? out : null;
}

export async function getReminderConfig() {
  const [rawOffsets, rawChannels, rawTemplate, rawEnabled] = await Promise.all([
    getSetting(KEYS.OFFSETS),
    getSetting(KEYS.CHANNELS),
    getSetting(KEYS.TEMPLATE),
    getSetting(KEYS.ENABLED),
  ]);
  const offsets = cleanOffsets(parseArray(rawOffsets) || []);
  const channels = cleanChannels(parseArray(rawChannels) || []);
  return {
    enabled: rawEnabled === null || rawEnabled === undefined ? DEFAULTS.enabled : rawEnabled === 'true',
    offsetsHours: offsets || [...DEFAULTS.offsetsHours],
    channels: channels || [...DEFAULTS.channels],
    templateName: (rawTemplate || '').trim() || DEFAULTS.templateName,
    allowedChannels: [...REMINDER_CHANNELS],
  };
}

export async function setReminderConfig(patch = {}) {
  if (patch.offsetsHours !== undefined) {
    if (!Array.isArray(patch.offsetsHours)) throw new ValidationError('offsetsHours must be an array of whole hours');
    const offsets = cleanOffsets(patch.offsetsHours);
    if (!offsets) {
      throw new ValidationError(
        `offsetsHours must contain 1-${MAX_OFFSETS} whole numbers between ${MIN_OFFSET_HOURS} and ${MAX_OFFSET_HOURS} hours`,
      );
    }
    await setSetting(KEYS.OFFSETS, JSON.stringify(offsets));
  }

  if (patch.channels !== undefined) {
    if (!Array.isArray(patch.channels)) throw new ValidationError('channels must be an array');
    const channels = cleanChannels(patch.channels);
    if (!channels) throw new ValidationError(`channels must be a non-empty subset of ${REMINDER_CHANNELS.join(', ')}`);
    await setSetting(KEYS.CHANNELS, JSON.stringify(channels));
  }

  if (patch.templateName !== undefined) {
    const name = String(patch.templateName || '').trim();
    if (!name) throw new ValidationError('templateName is required');
    await setSetting(KEYS.TEMPLATE, name);
  }

  if (patch.enabled !== undefined) {
    await setSetting(KEYS.ENABLED, patch.enabled ? 'true' : 'false');
  }

  return getReminderConfig();
}

// --------------------------------- formatting --------------------------------

function formatWhen(date) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reminderText({ customerName, when, doctorName, serviceName }) {
  const what = serviceName ? `${serviceName} with ${doctorName}` : `your appointment with ${doctorName}`;
  return `Hi ${customerName}, this is a reminder for ${what} on ${when}. Reply to this message if you need to reschedule.`;
}

function reminderHtml({ customerName, when, doctorName, serviceName }) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">
  <p>Hi ${esc(customerName)},</p>
  <p>This is a friendly reminder of your upcoming appointment:</p>
  <table cellpadding="6" style="border-collapse:collapse;margin:12px 0">
    <tr><td style="color:#6b7280">When</td><td><b>${esc(when)}</b></td></tr>
    <tr><td style="color:#6b7280">With</td><td><b>${esc(doctorName)}</b></td></tr>
    ${serviceName ? `<tr><td style="color:#6b7280">Service</td><td>${esc(serviceName)}</td></tr>` : ''}
  </table>
  <p>If you need to reschedule or cancel, simply reply to this email.</p>
  <p style="color:#6b7280;font-size:13px">See you soon.</p>
</div>`;
}

// ----------------------------------- sending ---------------------------------

// Returns { status, detail } — never throws; a thrown provider error becomes FAILED.
async function sendReminder({ appointment, channel, config }) {
  const customer = appointment.customer;
  const facts = {
    customerName: customer?.name || 'there',
    when: formatWhen(appointment.scheduledAt),
    doctorName: appointment.doctor?.name || 'your practitioner',
    serviceName: appointment.service?.name || null,
  };

  try {
    if (channel === 'WHATSAPP') {
      // §9A: business-initiated + usually outside the 24h window -> template only,
      // and always through the sendGuard choke point.
      const conversation = await prisma.conversation.findFirst({
        where: { customerId: appointment.customerId, channel: 'WHATSAPP' },
        select: { id: true },
      });
      if (!conversation) {
        return { status: 'SKIPPED', detail: 'No WhatsApp conversation on file for this patient' };
      }
      const result = await sendGuard.send({
        conversationId: conversation.id,
        templateName: config.templateName,
        templateParams: [facts.customerName, facts.when, facts.doctorName],
        senderType: 'SYSTEM',
        initiatedBy: 'SYSTEM:REMINDER',
      });
      if (result.ok) {
        return { status: 'SENT', detail: `template ${config.templateName}${result.dryRun ? ' (dry-run)' : ''}` };
      }
      // A policy block is an expected outcome, not an error.
      return { status: 'SKIPPED', detail: result.reason };
    }

    if (channel === 'EMAIL') {
      if (!customer?.email) return { status: 'SKIPPED', detail: 'Patient has no email address' };
      const result = await sendEmail({
        to: customer.email,
        subject: `Appointment reminder — ${facts.when}`,
        html: reminderHtml(facts),
        text: reminderText(facts),
      });
      if (result.ok) return { status: 'SENT', detail: result.dryRun ? 'email (dry-run)' : `email to ${customer.email}` };
      return { status: 'FAILED', detail: result.error || 'Email provider error' };
    }

    if (channel === 'SMS') {
      if (!customer?.phone) return { status: 'SKIPPED', detail: 'Patient has no phone number' };
      const result = await sendSms({ to: customer.phone, body: reminderText(facts) });
      if (result.ok) return { status: 'SENT', detail: result.dryRun ? 'sms (dry-run)' : `sms to ${customer.phone}` };
      return { status: 'FAILED', detail: result.error || 'SMS provider error' };
    }

    return { status: 'SKIPPED', detail: `Unsupported reminder channel ${channel}` };
  } catch (err) {
    return { status: 'FAILED', detail: err.message };
  }
}

// Writes the audit row. Returns false when the row already existed (P2002),
// which means another tick already handled this (appointment, offset, channel).
async function writeLog({ appointmentId, offsetHours, channel, status, detail }) {
  try {
    await prisma.reminderLog.create({
      data: {
        appointmentId,
        offsetHours,
        channel,
        status,
        detail: detail ? String(detail).slice(0, 500) : null,
      },
    });
    return true;
  } catch (err) {
    if (err.code === 'P2002') return false;
    throw err;
  }
}

export async function runReminderSweep(now = new Date()) {
  const config = await getReminderConfig();
  const counters = { checked: 0, sent: 0, skipped: 0, failed: 0 };

  for (const offsetHours of config.offsetsHours) {
    const from = new Date(now.getTime() + offsetHours * HOUR_MS);
    const to = new Date(from.getTime() + CATCH_UP_MS);

    const appointments = await prisma.appointment.findMany({
      where: { status: 'CONFIRMED', scheduledAt: { gte: from, lt: to } },
      include: {
        customer: { include: { identities: true } },
        doctor: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    for (const appointment of appointments) {
      counters.checked += 1;
      const already = await prisma.reminderLog.findMany({
        where: { appointmentId: appointment.id, offsetHours },
        select: { channel: true },
      });
      const done = new Set(already.map((r) => r.channel));

      for (const channel of config.channels) {
        if (done.has(channel)) continue;
        const outcome = await sendReminder({ appointment, channel, config });
        const written = await writeLog({
          appointmentId: appointment.id,
          offsetHours,
          channel,
          status: outcome.status,
          detail: outcome.detail,
        });
        if (!written) continue; // a concurrent tick got there first
        if (outcome.status === 'SENT') counters.sent += 1;
        else if (outcome.status === 'FAILED') counters.failed += 1;
        else counters.skipped += 1;
      }
    }
  }

  if (counters.sent || counters.failed) {
    log.info('Reminder sweep complete', counters);
    emitAll('reminder:swept', counters);
  }
  return counters;
}

export async function listReminderLogs(limit = 100) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const rows = await prisma.reminderLog.findMany({
    orderBy: { sentAt: 'desc' },
    take,
    include: {
      appointment: {
        select: {
          id: true,
          scheduledAt: true,
          customer: { select: { name: true } },
          doctor: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    appointmentId: r.appointmentId,
    offsetHours: r.offsetHours,
    channel: r.channel,
    status: r.status,
    detail: r.detail,
    sentAt: r.sentAt,
    customerName: r.appointment?.customer?.name || null,
    doctorName: r.appointment?.doctor?.name || null,
    scheduledAt: r.appointment?.scheduledAt || null,
  }));
}

export function startReminderScheduler() {
  const tick = async () => {
    const { enabled } = await getReminderConfig();
    if (!enabled) return;
    await runReminderSweep();
  };
  const task = cron.schedule('*/5 * * * *', () => {
    tick().catch((err) => log.error('Reminder sweep failed', { error: err.message }));
  });
  log.info('Reminder scheduler started (runs every 5 min)');
  return task;
}
