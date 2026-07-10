// Anthropic Claude provider. Returns null when no API key is configured so the
// caller can fall back to the mock provider.
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../../config/env.js';

let client = null;
function getClient() {
  if (!env.ai.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: env.ai.anthropicApiKey });
  return client;
}

export async function generateAnthropicReply({ systemPrompt, history }) {
  const c = getClient();
  if (!c) return null;

  const messages = history
    .filter((h) => h.content && h.content.trim())
    .map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));

  // Anthropic requires the first message to be from the user.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return null;

  const resp = await c.messages.create({
    model: env.ai.model,
    max_tokens: 500,
    system: systemPrompt,
    messages,
  });

  const textParts = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text);
  const text = textParts.join('\n').trim();
  return text || null;
}
