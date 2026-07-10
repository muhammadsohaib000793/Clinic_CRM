// Converts the three Meta inbound payload shapes (WhatsApp / Messenger /
// Instagram) into one normalized inbound-message shape the ingester understands.
import { CHANNELS } from '../config/constants.js';

function toMs(ts) {
  if (!ts) return Date.now();
  const n = Number(ts);
  if (!Number.isFinite(n)) return Date.now();
  // WhatsApp timestamps are in seconds; Messenger/IG are in milliseconds.
  return n < 1e12 ? n * 1000 : n;
}

function labelFor(channel) {
  if (channel === CHANNELS.WHATSAPP) return 'WhatsApp';
  if (channel === CHANNELS.INSTAGRAM) return 'Instagram';
  if (channel === CHANNELS.MESSENGER) return 'Facebook';
  return 'Unknown';
}

function make(channel, externalId, senderName, text, externalMessageId, timestampMs) {
  return {
    channel,
    externalId: externalId != null ? String(externalId) : null,
    senderName: senderName || null,
    text: text || '',
    externalMessageId: externalMessageId || null,
    timestampMs,
    channelLabel: labelFor(channel),
  };
}

export function normalizeWebhook(body) {
  const out = [];
  const object = body?.object;
  const entries = body?.entry || [];

  // ---- WhatsApp Cloud API -------------------------------------------------
  if (object === 'whatsapp_business_account') {
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const names = {};
        for (const c of value.contacts || []) names[c.wa_id] = c.profile?.name;
        for (const m of value.messages || []) {
          const text =
            m.type === 'text' || m.text ? m.text?.body || '' : `[${m.type || 'non-text'} message]`;
          out.push(make(CHANNELS.WHATSAPP, m.from, names[m.from], text, m.id, toMs(m.timestamp)));
        }
      }
    }
    return out;
  }

  // ---- Messenger (page) / Instagram --------------------------------------
  if (object === 'page' || object === 'instagram') {
    const channel = object === 'instagram' ? CHANNELS.INSTAGRAM : CHANNELS.MESSENGER;
    for (const entry of entries) {
      for (const msg of entry.messaging || []) {
        if (!msg.message || msg.message.is_echo) continue; // ignore echoes / delivery receipts
        const text =
          msg.message.text ||
          (Array.isArray(msg.message.attachments) && msg.message.attachments.length
            ? '[attachment]'
            : '');
        out.push(make(channel, msg.sender?.id, undefined, text, msg.message.mid, toMs(msg.timestamp)));
      }
    }
    return out;
  }

  return out; // unknown object -> nothing to ingest
}
