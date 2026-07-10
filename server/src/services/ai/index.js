// AI provider selection with automatic mock fallback.
import { env } from '../../config/env.js';
import { generateMockReply } from './providers/mock.js';
import { generateAnthropicReply } from './providers/anthropic.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ai');

export function currentProvider() {
  if (env.ai.provider === 'anthropic' && env.ai.anthropicApiKey) return 'anthropic';
  return 'mock';
}

export async function generateReply({ systemPrompt, history, latestInbound, customerName }) {
  if (currentProvider() === 'anthropic') {
    try {
      const text = await generateAnthropicReply({ systemPrompt, history });
      if (text) return { text, provider: 'anthropic' };
      log.warn('Anthropic returned empty response; using mock fallback');
    } catch (err) {
      log.error('Anthropic call failed; using mock fallback', { error: err.message });
    }
  }
  const text = await generateMockReply({ latestInbound, customerName });
  return { text, provider: 'mock' };
}
