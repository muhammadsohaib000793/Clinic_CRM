import { AppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('http');

export function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    if (err.status >= 500) log.error(err.message, { code: err.code });
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  // Common Prisma error mappings.
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Unique constraint violation', details: err.meta },
    });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
  }
  log.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
