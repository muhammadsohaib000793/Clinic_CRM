// Public messaging API. Callers should ONLY use send()/previewPolicy() from here
// (or sendGuard) — never a channel sender directly.
export { send, previewPolicy, evaluatePolicy } from './sendGuard.js';
export { describeWindow, isWindowOpen, windowRemainingMs } from './windowPolicy.js';
export { instagramHourlyUsage, canSendInstagram } from './rateLimiter.js';
export { lookupTemplate, renderTemplateBody, listTemplates } from './templates.js';
export { channelDryRunStatus } from './channels/index.js';
