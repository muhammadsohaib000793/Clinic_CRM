// The Meta 24-hour customer-service window (§9A).
// A conversation's window is OPEN when the customer messaged within the last 24h.
// Inside the window: free-form replies are allowed.
// Outside the window: ONLY an approved template may be sent (re-engagement).
import { CUSTOMER_SERVICE_WINDOW_MS } from '../../config/constants.js';

export function isWindowOpen(lastInboundAt, now = new Date()) {
  if (!lastInboundAt) return false; // never messaged us => window is closed
  const delta = now.getTime() - new Date(lastInboundAt).getTime();
  return delta >= 0 && delta < CUSTOMER_SERVICE_WINDOW_MS;
}

export function windowRemainingMs(lastInboundAt, now = new Date()) {
  if (!lastInboundAt) return 0;
  const remaining = CUSTOMER_SERVICE_WINDOW_MS - (now.getTime() - new Date(lastInboundAt).getTime());
  return Math.max(0, remaining);
}

// Convenience for the UI: describe the window state of a conversation.
export function describeWindow(lastInboundAt, now = new Date()) {
  const open = isWindowOpen(lastInboundAt, now);
  const remainingMs = windowRemainingMs(lastInboundAt, now);
  return {
    open,
    hasInbound: !!lastInboundAt,
    remainingMs,
    remainingMinutes: Math.floor(remainingMs / 60000),
    // What the send logic will require given this state:
    freeFormAllowed: open,
    templateRequired: !open,
  };
}
