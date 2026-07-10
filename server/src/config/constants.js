// Central constants for §9A ban-prevention and domain enums.
import { env } from './env.js';

// The Meta 24-hour customer-service window (ms).
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Instagram automated-DM rolling hourly cap (doc §9A: ~200/hr). Env-tunable margin.
export const INSTAGRAM_HOURLY_DM_CAP = env.instagramHourlyCap;
export const ONE_HOUR_MS = 60 * 60 * 1000;

// Channel enum values (mirror prisma Channel).
export const CHANNELS = Object.freeze({
  WHATSAPP: 'WHATSAPP',
  INSTAGRAM: 'INSTAGRAM',
  MESSENGER: 'MESSENGER',
  OTHER: 'OTHER',
});

export const SENDER_TYPES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  AGENT: 'AGENT',
  AI: 'AI',
  SYSTEM: 'SYSTEM',
});

export const CONVERSATION_STATUS = Object.freeze({
  OPEN: 'OPEN',
  FLAGGED: 'FLAGGED',
  AI_HANDLED: 'AI_HANDLED',
  CLOSED: 'CLOSED',
});

export const SEND_MODE = Object.freeze({ FREE_FORM: 'FREE_FORM', TEMPLATE: 'TEMPLATE' });
export const SEND_DECISION = Object.freeze({ ALLOWED: 'ALLOWED', BLOCKED: 'BLOCKED' });

// Human-readable block reasons — persisted to OutboundLog and surfaced in the UI.
export const BLOCK_REASONS = Object.freeze({
  NOT_OPTED_IN: 'blocked:not_opted_in',
  OUTSIDE_WINDOW_NO_TEMPLATE: 'blocked:outside_24h_window_requires_approved_template',
  TEMPLATE_NOT_APPROVED: 'blocked:template_not_approved',
  TEMPLATE_NOT_FOUND: 'blocked:template_not_found',
  WA_INITIATE_REQUIRES_TEMPLATE: 'blocked:whatsapp_initiate_requires_template',
  WA_RECIPIENT_NOT_ALLOWLISTED: 'blocked:whatsapp_test_recipient_not_allowlisted',
  IG_RATE_LIMIT: 'blocked:instagram_hourly_cap_reached',
  NO_RECIPIENT_IDENTITY: 'blocked:no_channel_identity_for_customer',
  EMPTY_CONTENT: 'blocked:empty_free_form_content',
  CHANNEL_SEND_ERROR: 'blocked:channel_send_error',
});

export const ALLOW_REASONS = Object.freeze({
  WITHIN_WINDOW: 'allowed:within_24h_window',
  APPROVED_TEMPLATE: 'allowed:approved_template',
});

export const SETTING_KEYS = Object.freeze({
  REDFLAG_THRESHOLD_MINUTES: 'redflag_threshold_minutes',
});
