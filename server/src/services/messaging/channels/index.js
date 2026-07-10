import { whatsapp } from './whatsapp.js';
import { messenger } from './messenger.js';
import { instagram } from './instagram.js';
import { CHANNELS } from '../../../config/constants.js';

const registry = {
  [CHANNELS.WHATSAPP]: whatsapp,
  [CHANNELS.MESSENGER]: messenger,
  [CHANNELS.INSTAGRAM]: instagram,
};

export function getChannelSender(channel) {
  const sender = registry[channel];
  if (!sender) throw new Error(`No sender implemented for channel: ${channel}`);
  return sender;
}

export function channelDryRunStatus() {
  return Object.fromEntries(
    Object.entries(registry).map(([ch, s]) => [ch, s.isDryRun()]),
  );
}

export { whatsapp, messenger, instagram };
