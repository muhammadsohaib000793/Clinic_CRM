export function timeAgo(date) {
  if (!date) return '';
  const d = new Date(date).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export function formatDateTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Map backend §9A block reasons to friendly, actionable messages.
export function blockReasonLabel(reason) {
  const map = {
    'blocked:not_opted_in': 'Customer has not opted in — cannot send (no cold messages).',
    'blocked:outside_24h_window_requires_approved_template':
      'Outside the 24-hour window — you must use an approved template to re-engage.',
    'blocked:template_not_approved': 'That template is not approved by Meta yet.',
    'blocked:template_not_found': 'Template not found.',
    'blocked:whatsapp_initiate_requires_template':
      'To start a WhatsApp conversation you must use an approved template.',
    'blocked:whatsapp_test_recipient_not_allowlisted':
      'This number is not in the WhatsApp test-recipient allowlist (test phase).',
    'blocked:instagram_hourly_cap_reached':
      'Instagram hourly DM cap reached — try again shortly (ban-prevention).',
    'blocked:no_channel_identity_for_customer': 'No channel identity on file for this customer.',
    'blocked:empty_free_form_content': 'Message is empty.',
    'blocked:channel_send_error': 'The channel rejected the send. Check credentials / recipient.',
  };
  return map[reason] || reason || 'Message blocked by messaging policy.';
}

export const CHANNEL_LABELS = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  MESSENGER: 'Messenger',
  OTHER: 'Other',
};
