import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import * as convo from '../services/conversations/service.js';
import { previewPolicy } from '../services/messaging/sendGuard.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { channel, status, assigned, flagged, search } = req.query;
    const conversations = await convo.listConversations({
      channel,
      status,
      assigned,
      flagged: flagged === 'true',
      agentId: req.agent.id,
      search,
    });
    res.json({ conversations });
  }),
);

conversationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ conversation: await convo.getConversation(req.params.id) });
  }),
);

// Non-mutating: what would happen if we sent this? (drives the composer UI)
conversationsRouter.get(
  '/:id/policy-preview',
  asyncHandler(async (req, res) => {
    const { content, templateName } = req.query;
    res.json(await previewPolicy({ conversationId: req.params.id, content, templateName }));
  }),
);

conversationsRouter.post(
  '/:id/claim',
  asyncHandler(async (req, res) => {
    res.json({ conversation: await convo.claimConversation(req.params.id, req.agent.id) });
  }),
);

conversationsRouter.post(
  '/:id/assign',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { agentId } = req.body || {};
    res.json({ conversation: await convo.assignConversation(req.params.id, agentId || null) });
  }),
);

conversationsRouter.post(
  '/:id/reply',
  asyncHandler(async (req, res) => {
    const { content, templateName, templateParams } = req.body || {};
    const result = await convo.replyToConversation(req.params.id, req.agent, {
      content,
      templateName,
      templateParams,
    });
    if (!result.ok) {
      // §9A block — surface the reason so the agent understands why.
      return res.status(422).json({
        error: { code: 'SEND_BLOCKED', message: `Message blocked: ${result.reason}`, reason: result.reason },
      });
    }
    res.json(result);
  }),
);

conversationsRouter.post(
  '/:id/takeover',
  asyncHandler(async (req, res) => {
    res.json({ conversation: await convo.takeoverConversation(req.params.id, req.agent) });
  }),
);

conversationsRouter.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    res.json({ conversation: await convo.setStatus(req.params.id, 'CLOSED') });
  }),
);

conversationsRouter.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    res.json({ conversation: await convo.setStatus(req.params.id, 'OPEN') });
  }),
);

conversationsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await convo.deleteConversation(req.params.id));
  }),
);
