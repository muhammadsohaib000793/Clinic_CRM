// Socket.IO event name constants — shared conceptually with the client.
export const EVENTS = Object.freeze({
  MESSAGE_NEW: 'message:new',
  MESSAGE_STATUS: 'message:status',
  CONVERSATION_UPDATED: 'conversation:updated',
  CONVERSATION_CLAIMED: 'conversation:claimed',
  CONVERSATION_FLAGGED: 'conversation:flagged',
  CONVERSATION_UNFLAGGED: 'conversation:unflagged',
  CONVERSATION_TAKEOVER: 'conversation:takeover',
  AGENT_STATUS: 'agent:status',
  APPOINTMENT_CREATED: 'appointment:created',
  SEND_BLOCKED: 'send:blocked',
});
