// Instagram DM sender (§9, Method A: reuse the Page Access Token).
// Endpoint: /<IG_BUSINESS_ACCOUNT_ID>/messages  with recipient IGSID.
// Instagram has no templates; outside the 24h window only a HUMAN_AGENT tag
// (up to 7 days) is permitted — modeled through the "template" path.
import { env } from '../../../config/env.js';
import { CHANNELS } from '../../../config/constants.js';
import { graphPost, forcedDryRun, dryResult } from './graph.js';
import { renderTemplateBody } from '../templates.js';
import { createLogger } from '../../../lib/logger.js';

const log = createLogger('instagram');

function dryRun() {
  return forcedDryRun() || !(env.meta.pageAccessToken && env.meta.igBusinessAccountId);
}

export const instagram = {
  channel: CHANNELS.INSTAGRAM,
  isDryRun: dryRun,

  async sendFreeForm(recipient, text) {
    if (dryRun()) {
      log.info('DRY-RUN free-form send', { to: recipient });
      return dryResult();
    }
    const data = await graphPost(`${env.meta.igBusinessAccountId}/messages`, env.meta.pageAccessToken, {
      recipient: { id: recipient },
      message: { text },
    });
    return { externalMessageId: data?.message_id || null, dryRun: false, raw: data };
  },

  async sendTemplate(recipient, template, params = []) {
    const body = renderTemplateBody(template, params);
    if (dryRun()) {
      log.info('DRY-RUN human-agent-tag send', { to: recipient, template: template.name });
      return { ...dryResult(), renderedBody: body };
    }
    const data = await graphPost(`${env.meta.igBusinessAccountId}/messages`, env.meta.pageAccessToken, {
      recipient: { id: recipient },
      messaging_type: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
      message: { text: body },
    });
    return { externalMessageId: data?.message_id || null, dryRun: false, raw: data, renderedBody: body };
  },
};
