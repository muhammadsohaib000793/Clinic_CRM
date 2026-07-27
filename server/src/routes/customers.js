import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import * as customers from '../services/customers/service.js';
import { logAudit } from '../services/audit/service.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      await customers.listCustomers({
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset,
      }),
    );
  }),
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await customers.getCustomer(req.params.id);
    logAudit({ agentId: req.agent.id, agentName: req.agent.name, action: 'VIEW_CUSTOMER', customerId: req.params.id });
    res.json({ customer });
  }),
);

customersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await customers.updateCustomer(req.params.id, req.body || {});
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'UPDATE_CUSTOMER',
      customerId: req.params.id,
      detail: Object.keys(req.body || {}).join(', '),
    });
    res.json({ customer });
  }),
);

customersRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    logAudit({ agentId: req.agent.id, agentName: req.agent.name, action: 'DELETE_CUSTOMER', customerId: req.params.id });
    res.json(await customers.deleteCustomer(req.params.id));
  }),
);
