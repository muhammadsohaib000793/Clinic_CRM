import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import * as customers from '../services/customers/service.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ customers: await customers.listCustomers({ search: req.query.search }) });
  }),
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ customer: await customers.getCustomer(req.params.id) });
  }),
);

customersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ customer: await customers.updateCustomer(req.params.id, req.body || {}) });
  }),
);
