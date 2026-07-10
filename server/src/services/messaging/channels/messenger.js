// Facebook Messenger sender (§9). Uses the Page Access Token.
// Endpoint: /<PAGE_ID>/messages  with recipient PSID.
// Note: Messenger has no WhatsApp-style templates. Outside the 24h window it
// requires a valid *message tag*; we model that as the "template" path so the
// send-guard's one interface stays uniform across channels.
import { env } from '../../../config/env.js';
import { CHANNELS } from '../../../config/constants.js';
import { graphPost, forcedDryRun, dryResult } from './graph.js';
import { renderTemplateBody } from '../templates.js';
import { createLogger } from '../../../lib/logger.js';

const log = createLogger('messenger');

function dryRun() {
  return forcedDryRun() || !(env.meta.pageAccessToken && env.meta.pageId);
}

export const messenger = {
  channel: CHANNELS.MESSENGER,
  isDryRun: dryRun,

  async sendFreeForm(recipient, text) {
    if (dryRun()) {
      log.info('DRY-RUN free-form send', { to: recipient });
      return dryResult();
    }
    const data = await graphPost(`${env.meta.pageId}/messages`, env.meta.pageAccessToken, {
      recipient: { id: recipient },
      messaging_type: 'RESPONSE',
      message: { text },
    });
    return { externalMessageId: data?.message_id || null, dryRun: false, raw: data };
  },

  // Tagged message for out-of-window re-engagement (default: ACCOUNT_UPDATE).
  async sendTemplate(recipient, template, params = []) {
    const body = renderTemplateBody(template, params);
    if (dryRun()) {
      log.info('DRY-RUN tagged send', { to: recipient, template: template.name });
      return { ...dryResult(), renderedBody: body };
    }
    const data = await graphPost(`${env.meta.pageId}/messages`, env.meta.pageAccessToken, {
      recipient: { id: recipient },
      messaging_type: 'MESSAGE_TAG',
      tag: 'ACCOUNT_UPDATE',
      message: { text: body },
    });
    return { externalMessageId: data?.message_id || null, dryRun: false, raw: data, renderedBody: body };
  },
};
