import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  listMovements,
  lowStockProducts,
  inventoryStats,
} from '../services/inventory/service.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    res.json(
      await listProducts({
        search: req.query.search,
        category: req.query.category,
        activeOnly: req.query.activeOnly,
        lowStockOnly: req.query.lowStockOnly,
        limit: req.query.limit,
        offset: req.query.offset,
      }),
    );
  }),
);

inventoryRouter.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    res.json({ product: await getProduct(req.params.id) });
  }),
);

inventoryRouter.post(
  '/products',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ product: await createProduct(req.body || {}) });
  }),
);

inventoryRouter.patch(
  '/products/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ product: await updateProduct(req.params.id, req.body || {}) });
  }),
);

inventoryRouter.delete(
  '/products/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await deleteProduct(req.params.id));
  }),
);

// Any authenticated agent can move stock — the movement records who did it.
inventoryRouter.post(
  '/stock/adjust',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    res.json({
      product: await adjustStock({
        productId: body.productId,
        type: body.type,
        quantity: body.quantity,
        reason: body.reason,
        agentId: req.agent?.id,
      }),
    });
  }),
);

inventoryRouter.get(
  '/movements',
  asyncHandler(async (req, res) => {
    res.json({ movements: await listMovements({ productId: req.query.productId, limit: req.query.limit }) });
  }),
);

inventoryRouter.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    res.json({ products: await lowStockProducts() });
  }),
);

inventoryRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json({ stats: await inventoryStats() });
  }),
);
