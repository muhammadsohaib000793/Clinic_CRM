// WhatsApp Cloud API sender (§9, §11). Endpoint: /<PHONE_NUMBER_ID>/messages.
import { env } from '../../../config/env.js';
import { CHANNELS } from '../../../config/constants.js';
import { graphPost, forcedDryRun, dryResult } from './graph.js';
import { renderTemplateBody } from '../templates.js';
import { createLogger } from '../../../lib/logger.js';

const log = createLogger('wa');

function dryRun() {
  return forcedDryRun() || !(env.whatsapp.accessToken && env.whatsapp.phoneNumberId);
}

export const whatsapp = {
  channel: CHANNELS.WHATSAPP,
  isDryRun: dryRun,

  async sendFreeForm(recipient, text) {
    if (dryRun()) {
      log.info('DRY-RUN free-form send', { to: recipient });
      return dryResult();
    }
    const data = await graphPost(`${env.whatsapp.phoneNumberId}/messages`, env.whatsapp.accessToken, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { body: text, preview_url: false },
    });
    return { externalMessageId: data?.messages?.[0]?.id || null, dryRun: false, raw: data };
  },

  // WhatsApp template message — required to initiate / re-engage outside 24h.
  async sendTemplate(recipient, template, params = []) {
    if (dryRun()) {
      log.info('DRY-RUN template send', { to: recipient, template: template.name });
      return { ...dryResult(), renderedBody: renderTemplateBody(template, params) };
    }
    const components = params.length
      ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
      : [];
    const data = await graphPost(`${env.whatsapp.phoneNumberId}/messages`, env.whatsapp.accessToken, {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components,
      },
    });
    return {
      externalMessageId: data?.messages?.[0]?.id || null,
      dryRun: false,
      raw: data,
      renderedBody: renderTemplateBody(template, params),
    };
  },
};
