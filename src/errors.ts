// src/errors.ts
import { NebulaErrorResponse } from './types';

/** Base class for all SDK-specific errors */
export class NebulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NebulaError';
    Object.setPrototypeOf(this, NebulaError.prototype);
  }
}

/** Error representing issues during API communication */
export class ApiError extends NebulaError {
  public statusCode: number;
  public errorData?: NebulaErrorResponse; // Original error data from API if available

  constructor(message: string, statusCode: number, errorData?: NebulaErrorResponse) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorData = errorData;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Error for network issues or unexpected client-side problems during fetch */
export class NetworkError extends NebulaError {
  public cause?: Error; // Original underlying error if available

  constructor(message: string = 'A network error occurred.', cause?: Error) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/** Error when a request times out */
export class TimeoutError extends NetworkError {
  constructor(message: string = 'The request timed out.') {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

// --- Specific API Error Subclasses ---

/** Error for authentication failures (401 Unauthorized) */
export class AuthError extends ApiError {
  constructor(
    message: string = 'Authentication failed. Check credentials or token.',
    errorData?: NebulaErrorResponse
  ) {
    super(message, 401, errorData);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/** Error for authorization failures (403 Forbidden) */
export class ForbiddenError extends ApiError {
  constructor(message: string = 'Permission denied.', errorData?: NebulaErrorResponse) {
    super(message, 403, errorData);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/** Error for resource not found (404 Not Found) */
export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found.', errorData?: NebulaErrorResponse) {
    super(message, 404, errorData);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/** Error for invalid request input (400 Bad Request) */
export class BadRequestError extends ApiError {
  constructor(message: string = 'Bad request. Invalid input.', errorData?: NebulaErrorResponse) {
    super(message, 400, errorData);
    this.name = 'BadRequestError';
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

/** Error for rate limiting (429 Too Many Requests) */
export class RateLimitError extends ApiError {
  constructor(
    message: string = 'Too many requests. Please wait and try again.',
    errorData?: NebulaErrorResponse
  ) {
    super(message, 429, errorData);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/** Error for server-side issues (5xx Server Error) */
export class ServerError extends ApiError {
  constructor(
    message: string = 'An unexpected server error occurred.',
    statusCode: number,
    errorData?: NebulaErrorResponse
  ) {
    // Ensure status code is >= 500, default to 500 if not passed correctly
    const validStatusCode = statusCode >= 500 ? statusCode : 500;
    super(message, validStatusCode, errorData);
    this.name = 'ServerError';
    Object.setPrototypeOf(this, ServerError.prototype);
  }
}
