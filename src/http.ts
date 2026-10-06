import { NebulaClientConfig, NebulaErrorResponse } from './types';
import {
  ApiError,
  NetworkError,
  TimeoutError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  ConflictError,
  RateLimitError,
  ServerError,
} from './errors';
import { DEFAULT_TIMEOUT } from './config';

/** @internal Authentication policy for an individual endpoint. */
export type RequestAuthentication = 'auto' | 'bearer' | 'none';

/** @internal Request configuration with the current session credentials. */
export interface RequestContext extends NebulaClientConfig {
  authToken?: string | null;
  authentication?: RequestAuthentication;
}

function authorization(context: RequestContext): string | undefined {
  if (context.authentication === 'none') return undefined;
  if (context.authToken) return `Bearer ${context.authToken}`;
  if (context.authentication === 'bearer') {
    throw new AuthError('This operation requires a JWT. Call setAuthToken() after logging in.');
  }
  if (context.apiKey) return `ApiKey ${context.apiKey}`;
  throw new AuthError('Authentication required. Set a JWT token or configure a database API key.');
}

function errorData(value: unknown, status: number): NebulaErrorResponse {
  if (value !== null && typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    if (typeof payload.error === 'string') return payload as unknown as NebulaErrorResponse;
    if (typeof payload.message === 'string') return { error: payload.message };
  }
  return { error: `HTTP error! Status: ${status}` };
}

function throwApiError(status: number, data: NebulaErrorResponse): never {
  switch (status) {
    case 400:
      throw new BadRequestError(data.error, data);
    case 401:
      throw new AuthError(data.error, data);
    case 403:
      throw new ForbiddenError(data.error, data);
    case 404:
      throw new NotFoundError(data.error, data);
    case 409:
      throw new ConflictError(data.error, data);
    case 429:
      throw new RateLimitError(data.error, data);
    default:
      if (status >= 500) throw new ServerError(data.error, status, data);
      throw new ApiError(data.error, status, data);
  }
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
    if (!response.ok) return null;
    throw new NetworkError('Expected a JSON response from the API.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    if (!response.ok) return null;
    throw new NetworkError('Received invalid JSON from the API.', cause as Error);
  }
}

/**
 * Sends one request without automatic retries. The deadline includes reading the response body.
 * @internal
 */
export async function makeRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  context: RequestContext,
  queryParams?: Record<string, string | number | boolean>,
  body?: unknown
): Promise<T> {
  return sendRequest(
    path,
    method,
    context,
    queryParams,
    body,
    'application/json',
    async (response) => (await readResponse(response)) as T
  );
}

/** @internal Buffered binary GET; shares authentication, errors, and the body-read deadline. */
export async function makeBinaryRequest(
  path: string,
  context: RequestContext
): Promise<Uint8Array> {
  return sendRequest(
    path,
    'GET',
    context,
    undefined,
    undefined,
    'application/octet-stream',
    async (response) => new Uint8Array(await response.arrayBuffer())
  );
}

async function sendRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  context: RequestContext,
  queryParams: Record<string, string | number | boolean> | undefined,
  body: unknown,
  accept: string,
  readResult: (response: Response) => Promise<T>
): Promise<T> {
  const fetchFn = context.fetch ?? globalThis.fetch;
  const requestTimeout = context.timeout ?? DEFAULT_TIMEOUT;
  const url = new URL(`${context.baseURL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
    });
  }

  const headers: Record<string, string> = { Accept: accept };
  const credential = authorization(context);
  if (credential) headers.Authorization = credential;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

  try {
    const response = await fetchFn(url.toString(), {
      method,
      headers,
      body: serializedBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      const result = await readResponse(response);
      throwApiError(response.status, errorData(result, response.status));
    }
    return await readResult(response);
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new TimeoutError(`Request timed out after ${requestTimeout}ms`);
    }
    if (cause instanceof ApiError || cause instanceof NetworkError) throw cause;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    throw new NetworkError(`Failed to fetch: ${error.message}`, error);
  } finally {
    clearTimeout(timeoutId);
  }
}
