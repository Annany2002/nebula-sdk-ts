import { NebulaError, NetworkError } from '../errors';
import { AuthRequestOptions, SignupResponse, UpdateProfileResponse, User } from '../types';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function authOptions(options: AuthRequestOptions): AuthRequestOptions {
  const fields = object(options);
  if (!fields || Object.keys(fields).some((key) => !['timeout', 'signal'].includes(key))) {
    throw new NebulaError('Auth request options accept only timeout and signal.');
  }
  const { timeout, signal } = options;
  if (
    timeout !== undefined &&
    (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647)
  ) {
    throw new NebulaError('timeout must be an integer from 1 to 2147483647 milliseconds.');
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new NebulaError('signal must be an AbortSignal.');
  }
  return { timeout, signal };
}

/** Keep identity unchanged; the server remains authoritative for mailbox grammar. */
export function validateEmail(email: unknown): asserts email is string {
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !email.includes('@') ||
    /[^\x20-\x7e]/.test(email)
  ) {
    throw new NebulaError('Provide a plain ASCII email address of at most 254 bytes.');
  }
}

export function validateVerificationToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new NebulaError('Provide the verification token from the email link, not the full URL.');
  }
}

function invalidResponse(): never {
  throw new NetworkError('Unconfirmed account response. Check account state before retrying.');
}

export function parseVerificationResponse(value: unknown): { message: string } {
  const result = object(value);
  if (!result || !nonempty(result.message)) return invalidResponse();
  return { message: result.message };
}

export function parseSignup(value: unknown): SignupResponse {
  const result = object(value);
  if (!result || !nonempty(result.message) || !nonempty(result.user_id)) return invalidResponse();
  if (
    result.verification_required !== undefined &&
    typeof result.verification_required !== 'boolean'
  ) {
    return invalidResponse();
  }
  const delivery = result.verification_delivery;
  if (delivery !== undefined && delivery !== 'sent' && delivery !== 'unconfirmed')
    return invalidResponse();
  if (result.verification_required === true && delivery === undefined) return invalidResponse();
  if (delivery !== undefined && result.verification_required !== true) return invalidResponse();
  return {
    message: result.message,
    user_id: result.user_id,
    ...(result.verification_required !== undefined && {
      verification_required: result.verification_required,
    }),
    ...(delivery !== undefined && { verification_delivery: delivery }),
  };
}

export function parseUser(value: unknown): User {
  const user = object(value);
  if (
    !user ||
    !nonempty(user.userId) ||
    !nonempty(user.email) ||
    !nonempty(user.username) ||
    !nonempty(user.createdAt)
  ) {
    return invalidResponse();
  }
  if (
    ['email_verified', 'verification_required'].some(
      (key) => user[key] !== undefined && typeof user[key] !== 'boolean'
    )
  )
    return invalidResponse();
  if (user.pending_email !== undefined && !nonempty(user.pending_email)) return invalidResponse();
  if (user.role !== undefined && user.role !== 'user' && user.role !== 'admin')
    return invalidResponse();
  return {
    userId: user.userId,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
    ...(user.role !== undefined && { role: user.role }),
    ...(user.email_verified !== undefined && { email_verified: user.email_verified as boolean }),
    ...(user.verification_required !== undefined && {
      verification_required: user.verification_required as boolean,
    }),
    ...(user.pending_email !== undefined && { pending_email: user.pending_email as string }),
  };
}

export function parseProfileUpdate(
  value: unknown,
  status: number,
  target?: string
): UpdateProfileResponse {
  const result = object(value);
  if (!result || !nonempty(result.message)) return invalidResponse();
  if (status === 202) {
    if (!target || result.pending_email !== target || result.user !== undefined)
      return invalidResponse();
    return { message: result.message, pending_email: target };
  }
  if (result.pending_email !== undefined) return invalidResponse();
  const user = parseUser(result.user);
  if (target !== undefined && user.email !== target) return invalidResponse();
  return { message: result.message, user };
}

export function validatePasswordReset(payload: unknown): void {
  const fields = object(payload);
  if (!fields || Object.keys(fields).some((key) => !['token', 'password'].includes(key)))
    throw new NebulaError('Password reset accepts only token and password.');
  if (
    typeof fields.token !== 'string' ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(fields.token)
  )
    throw new NebulaError('Provide the password reset token from the email, not its URL.');
  const password = fields.password;
  if (
    typeof password !== 'string' ||
    Array.from(password).length < 8 ||
    new TextEncoder().encode(password).length > 72 ||
    /[\uD800-\uDFFF]/u.test(password)
  )
    throw new NebulaError(
      'Password must contain at least 8 characters and at most 72 UTF-8 bytes.'
    );
}
