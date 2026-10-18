import { NebulaError, NetworkError } from '../errors';
import {
  AuthProvidersResponse,
  GitHubAuthorizationResponse,
  GitHubCallbackPayload,
  GitHubLinkResponse,
  LoginResponse,
} from '../types';
import { parseUser } from './auth-validation';

function canonicalProof(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 43 &&
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)
  );
}
const requiredParameters = [
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
];
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function invalidResponse(): never {
  throw new NetworkError(
    'Unconfirmed GitHub response. Start a fresh GitHub sign-in; do not replay the code exchange.'
  );
}

export function validateGitHubStart(payload: unknown, linking = false): void {
  const fields = object(payload);
  const allowed = linking ? ['code_challenge', 'current_password'] : ['code_challenge'];
  if (
    !fields ||
    Object.keys(fields).some((key) => !allowed.includes(key)) ||
    !canonicalProof(fields.code_challenge)
  )
    throw new NebulaError(
      'Provide only a canonical S256 code_challenge and, when linking, your current password.'
    );
  if (
    linking &&
    (typeof fields.current_password !== 'string' ||
      !fields.current_password.length ||
      new TextEncoder().encode(fields.current_password).length > 72 ||
      /[\uD800-\uDFFF]/u.test(fields.current_password))
  )
    throw new NebulaError('Provide your current password (at most 72 UTF-8 bytes).');
}

export function validateGitHubCallback(payload: unknown): asserts payload is GitHubCallbackPayload {
  const fields = object(payload);
  if (
    !fields ||
    Object.keys(fields).some((key) => !['code', 'state', 'code_verifier'].includes(key)) ||
    typeof fields.code !== 'string' ||
    fields.code.length < 1 ||
    fields.code.length > 512 ||
    /[^\x21-\x7e]/.test(fields.code) ||
    !canonicalProof(fields.state) ||
    typeof fields.code_verifier !== 'string' ||
    fields.code_verifier.length < 43 ||
    fields.code_verifier.length > 128 ||
    /[^A-Za-z0-9._~-]/.test(fields.code_verifier)
  )
    throw new NebulaError(
      'Provide the opaque GitHub code, canonical state and original PKCE verifier, not the callback URL.'
    );
}

export function parseAuthProviders(value: unknown): AuthProvidersResponse {
  const providers = object(object(value)?.providers);
  if (
    !providers ||
    typeof providers.password !== 'boolean' ||
    typeof providers.github !== 'boolean'
  )
    return invalidResponse();
  return { providers: { password: providers.password, github: providers.github } };
}

function hasURLControls(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127;
  });
}

function validRedirect(value: string): boolean {
  if (hasURLControls(value)) return false;
  try {
    const redirect = new URL(value);
    const loopback =
      redirect.hostname === 'localhost' ||
      redirect.hostname === '[::1]' ||
      /^127\./.test(redirect.hostname);
    return (
      (redirect.protocol === 'https:' || (redirect.protocol === 'http:' && loopback)) &&
      !redirect.username &&
      !redirect.password &&
      !value.includes('?') &&
      !value.includes('#') &&
      redirect.pathname === '/auth/github/callback'
    );
  } catch {
    return false;
  }
}

export function parseGitHubAuthorization(
  value: unknown,
  challenge: string
): GitHubAuthorizationResponse {
  const result = object(value);
  if (
    !result ||
    typeof result.authorization_url !== 'string' ||
    result.authorization_url.length > 4096 ||
    hasURLControls(result.authorization_url) ||
    typeof result.expires_in !== 'number' ||
    !Number.isInteger(result.expires_in) ||
    result.expires_in < 1 ||
    result.expires_in > 600
  )
    return invalidResponse();
  let target: URL;
  try {
    target = new URL(result.authorization_url);
  } catch {
    return invalidResponse();
  }
  const params = target.searchParams;
  if (
    target.origin !== 'https://github.com' ||
    target.pathname !== '/login/oauth/authorize' ||
    target.username ||
    target.password ||
    result.authorization_url.includes('#') ||
    requiredParameters.some((name) => params.getAll(name).length !== 1) ||
    Array.from(params.keys()).some((name) => ![...requiredParameters, 'prompt'].includes(name)) ||
    !nonempty(params.get('client_id')) ||
    !canonicalProof(params.get('state')) ||
    params.get('code_challenge') !== challenge ||
    params.get('code_challenge_method') !== 'S256' ||
    params.get('scope') !== 'user:email' ||
    !validRedirect(params.get('redirect_uri') || '')
  )
    return invalidResponse();
  return { authorization_url: result.authorization_url, expires_in: result.expires_in };
}

export function parseGitHubLogin(value: unknown): LoginResponse {
  const result = object(value);
  if (!result || !nonempty(result.message) || !nonempty(result.token)) return invalidResponse();
  const user = parseUser(result.user);
  if (user.verification_required && !user.email_verified) return invalidResponse();
  return { message: result.message, token: result.token, user };
}

export function parseGitHubLink(value: unknown): GitHubLinkResponse {
  const result = object(value);
  // A login-shaped response must not silently sign the linking caller in to another account.
  if (
    !result ||
    !nonempty(result.message) ||
    result.token !== undefined ||
    result.user !== undefined
  )
    return invalidResponse();
  return { message: result.message };
}
