// Typed errors used across services and surfaced by the error middleware.

export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 400, 'VALIDATION', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details) {
    super(message, 409, 'CONFLICT', details);
    this.name = 'ConflictError';
  }
}

// Raised by sendGuard when a §9A rule blocks an outbound message.
export class SendBlockedError extends AppError {
  constructor(reason, details) {
    super(`Message blocked by policy: ${reason}`, 422, 'SEND_BLOCKED', details);
    this.name = 'SendBlockedError';
    this.reason = reason;
  }
}

// Small async wrapper so route handlers can throw and hit the error middleware.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
