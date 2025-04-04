// src/http.ts
import { NebulaClientConfig, NebulaErrorResponse } from "./types";
import { ApiError, NetworkError, TimeoutError } from "./errors";
import { DEFAULT_TIMEOUT, USER_AGENT } from "./config";

/**
 * Internal function to make HTTP requests to the Nebula API.
 * **Note:** This initial version does not handle authentication tokens.
 * @internal
 */
export async function makeRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  config: NebulaClientConfig,
  // We need the active token here later
  // authToken: string | null,
  queryParams?: Record<string, string | number | boolean>,
  body?: any,
): Promise<T> {
  const { baseURL, fetch: customFetch, timeout } = config;
  const fetchFn = customFetch || fetch;
  const requestTimeout = timeout ?? DEFAULT_TIMEOUT;

  // Construct URL with query parameters if provided
  const url = new URL(
    `${baseURL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`,
  );
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        // Handle potential undefined/null values
        url.searchParams.append(key, String(value));
      }
    });
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  // Add Content-Type header only if body exists
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  // TODO: Add Authorization header later:
  // if (authToken) {
  //   headers['Authorization'] = `Bearer ${authToken}`;
  // }

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
    if (error.name === "AbortError") {
      throw new TimeoutError(`Request timed out after ${requestTimeout}ms`);
    }
    throw new NetworkError(`Failed to fetch: ${error.message}`, error);
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle successful 'No Content' response (e.g., for DELETE)
  if (response.status === 204) {
    // Type assertion needed as T might not be void/null
    return null as T;
  }

  let responseBody: any;
  try {
    // Try parsing JSON, but handle potential non-JSON success responses if necessary
    // For now assume success means JSON or No Content
    const text = await response.text();
    if (text) {
      responseBody = JSON.parse(text);
    } else {
      responseBody = null; // Handle empty body case
    }
  } catch (e) {
    // If response.ok is true but JSON parsing failed, it's an issue
    if (response.ok) {
      throw new NetworkError(
        "Received non-JSON response from API when JSON was expected.",
        e as Error,
      );
    }
    // If it's an error status and non-JSON, create a basic error message for ApiError
    responseBody = {
      error: `Received status ${response.status} with non-JSON body.`,
    };
  }

  if (!response.ok) {
    const errorData = responseBody as NebulaErrorResponse;
    const errorMessage =
      errorData?.error || `HTTP error! Status: ${response.status}`;

    // TODO: Throw specific errors (Auth, NotFound, RateLimit, etc.) later based on status code
    throw new ApiError(errorMessage, response.status, errorData);
  }

  // Type assertion needed as responseBody is 'any'
  return responseBody as T;
}
