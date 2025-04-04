// src/errors.ts
import { NebulaErrorResponse } from "./types";

/** Base class for all SDK-specific errors */
export class NebulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NebulaError";
    Object.setPrototypeOf(this, NebulaError.prototype);
  }
}

/** Error representing issues during API communication */
export class ApiError extends NebulaError {
  public statusCode: number;
  public errorData?: NebulaErrorResponse; // Original error data from API if available

  constructor(
    message: string,
    statusCode: number,
    errorData?: NebulaErrorResponse,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errorData = errorData;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Error for network issues or unexpected client-side problems during fetch */
export class NetworkError extends NebulaError {
  public cause?: Error; // Original underlying error if available

  constructor(message: string = "A network error occurred.", cause?: Error) {
    super(message);
    this.name = "NetworkError";
    this.cause = cause;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/** Error when a request times out */
export class TimeoutError extends NetworkError {
  constructor(message: string = "The request timed out.") {
    super(message);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

// We will add specific ApiError subclasses (AuthError, NotFoundError, RateLimitError etc.) later
