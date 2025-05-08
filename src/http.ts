// src/http.ts
import { NebulaClientConfig, NebulaErrorResponse } from './types';
import {
  ApiError,
  NetworkError,
  TimeoutError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  RateLimitError,
  ServerError,
} from './errors';
import { DEFAULT_TIMEOUT, USER_AGENT } from './config';

/** Internal type for passing context to makeRequest */
interface RequestContext extends NebulaClientConfig {}

/**
 * Internal function to make HTTP requests to the Nebula API.
 * Handles adding auth token and mapping status codes to specific errors.
 * @internal
 */
export async function makeRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  context: RequestContext, // Use the combined context type
  queryParams?: Record<string, string | number | boolean>,
  body?: any
): Promise<T> {
  const { baseURL, fetch: customFetch, timeout, apiKey } = context; // Destructure authToken
  const fetchFn = customFetch || fetch;
  const requestTimeout = timeout ?? DEFAULT_TIMEOUT;

  const url = new URL(`${baseURL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    Authorization: `ApiKey ${apiKey}`,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  // Add Api

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new TimeoutError(`Request timed out after ${requestTimeout}ms`);
    }
    throw new NetworkError(`Failed to fetch: ${error.message}`, error);
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 204) {
    return null as T;
  }

  let responseBody: any;
  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  try {
    const text = await response.text();
    if (text && isJson) {
      responseBody = JSON.parse(text);
    } else if (text) {
      // Handle non-JSON response text if needed, maybe just use it as message?
      // If response.ok is true but non-JSON, could be problematic.
      responseBody = { message: text }; // Treat as simple message object
    } else {
      responseBody = null;
    }
  } catch (e) {
    if (response.ok) {
      throw new NetworkError(
        'Received non-JSON response from API when JSON was expected.',
        e as Error
      );
    }
    // Use a generic error structure if parsing fails on an error response
    responseBody = {
      error: `Received status ${response.status} with invalid JSON body.`,
    };
  }

  if (!response.ok) {
    // Use parsed body if available and looks like an error object, otherwise use default messages
    const errorData =
      responseBody && typeof responseBody === 'object' && 'error' in responseBody
        ? (responseBody as NebulaErrorResponse)
        : {
            error: responseBody?.message || `HTTP error! Status: ${response.status}`,
          };
    const errorMessage = errorData.error;

    // Throw specific errors based on status code
    switch (response.status) {
      case 400:
        throw new BadRequestError(errorMessage, errorData);
      case 401:
        throw new AuthError(errorMessage, errorData);
      case 403:
        throw new ForbiddenError(errorMessage, errorData);
      case 404:
        throw new NotFoundError(errorMessage, errorData);
      case 429:
        throw new RateLimitError(errorMessage, errorData);
      default:
        if (response.status >= 500) {
          throw new ServerError(errorMessage, response.status, errorData);
        }
        // Catch-all for other 4xx errors or unexpected statuses
        throw new ApiError(`Unhandled API Error: ${errorMessage}`, response.status, errorData);
    }
  }

  // Check if responseBody is null and T is not expecting null/void
  // This is tricky, might need adjustment based on specific API calls expecting non-JSON success
  if (responseBody === null && response.status !== 204) {
    // Consider if specific endpoints might return 200 OK with empty body
    // For now, assume T allows null/void or this case is handled by specific module logic
  }

  return responseBody as T;
}
