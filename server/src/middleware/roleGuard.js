import { ForbiddenError } from '../lib/errors.js';

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.agent) return next(new ForbiddenError('Authentication required'));
    if (!roles.includes(req.agent.role)) {
      return next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}
