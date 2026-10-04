// test/http.test.ts
import { makeRequest } from '../src/http';
import { NebulaClientConfig } from '../src/types';
import { RequestContext } from '../src/http';
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
} from '../src/errors';

const mockBaseURL = 'http://testhost.com';
const testApiKey = 'neb_testkey_for_http';

function createMockResponse(
  status: number,
  body: unknown = null,
  contentType = 'application/json'
): Response {
  return new Response(
    body === null ? null : typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: { 'Content-Type': contentType },
    }
  );
}

function mockContext(fetchFn: jest.Mock): Required<NebulaClientConfig> {
  return {
    baseURL: mockBaseURL,
    apiKey: testApiKey,
    timeout: 5000,
    fetch: fetchFn as typeof fetch,
  };
}

describe('makeRequest HTTP Client', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  it('should make a GET request successfully', async () => {
    const expected = { id: 1, name: 'Test' };
    mockFetch.mockResolvedValueOnce(createMockResponse(200, expected));

    const result = await makeRequest<typeof expected>('/resource/1', 'GET', mockContext(mockFetch));
    expect(result).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://testhost.com/resource/1');
    expect(opts.method).toBe('GET');
  });

  it('should make a POST request with body', async () => {
    const body = { name: 'New' };
    const expected = { id: 2, name: 'New' };
    mockFetch.mockResolvedValueOnce(createMockResponse(201, expected));

    const result = await makeRequest<typeof expected>(
      '/resource',
      'POST',
      mockContext(mockFetch),
      undefined,
      body
    );
    expect(result).toEqual(expected);

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual(body);
  });

  it('should append query parameters to URL', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(200, []));

    await makeRequest('/items', 'GET', mockContext(mockFetch), { category: 'books', limit: 10 });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('category=books');
    expect(url).toContain('limit=10');
  });

  it('should return null for 204 No Content', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(204));

    const result = await makeRequest<void>('/resource/1', 'DELETE', mockContext(mockFetch));
    expect(result).toBeNull();
  });

  it('should include ApiKey Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(200, {}));

    await makeRequest('/secure', 'GET', mockContext(mockFetch));

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe(`ApiKey ${testApiKey}`);
  });

  it('should include Content-Type header only when body is present', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(200, {}));
    await makeRequest('/get', 'GET', mockContext(mockFetch));
    expect(mockFetch.mock.calls[0][1].headers['Content-Type']).toBeUndefined();

    mockFetch.mockResolvedValueOnce(createMockResponse(201, {}));
    await makeRequest('/post', 'POST', mockContext(mockFetch), undefined, { data: 1 });
    expect(mockFetch.mock.calls[1][1].headers['Content-Type']).toBe('application/json');
  });

  // --- Error mapping ---
  test.each([
    [400, BadRequestError, 'Bad Request'],
    [401, AuthError, 'Unauthorized'],
    [403, ForbiddenError, 'Forbidden'],
    [409, ConflictError, 'Conflict'],
    [404, NotFoundError, 'Not Found'],
    [429, RateLimitError, 'Too Many Requests'],
    [500, ServerError, 'Internal Server Error'],
    [503, ServerError, 'Service Unavailable'],
  ])('should throw correct error for status %i', async (status, ExpectedError, apiMsg) => {
    mockFetch.mockResolvedValueOnce(createMockResponse(status, { error: apiMsg }));

    try {
      await makeRequest('/error', 'GET', mockContext(mockFetch));
      throw new Error('Should have thrown');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error).toBeInstanceOf(ExpectedError);
      expect(error.statusCode).toBe(status);
      expect(error.message).toContain(apiMsg);
    }
  });

  it('should throw NetworkError when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(makeRequest('/fail', 'GET', mockContext(mockFetch))).rejects.toThrow(NetworkError);
  });

  it('should throw TimeoutError when fetch aborts', async () => {
    const ctx = { ...mockContext(mockFetch), timeout: 50 };
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          }, 60);
        })
    );

    await expect(makeRequest('/slow', 'GET', ctx)).rejects.toThrow(TimeoutError);
  });

  it('should throw ApiError for unhandled status codes (e.g., 418)', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(418, { error: "I'm a teapot" }));

    try {
      await makeRequest('/teapot', 'GET', mockContext(mockFetch));
      throw new Error('Should have thrown');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(ServerError);
      expect(error.statusCode).toBe(418);
    }
  });

  it('should handle non-JSON error responses', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(500, '<h1>Error</h1>', 'text/html'));

    await expect(makeRequest('/html', 'GET', mockContext(mockFetch))).rejects.toThrow(ServerError);
  });
});

describe('HTTP authentication and response boundaries', () => {
  const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => jest.useRealTimers());

  const context = (): RequestContext => ({
    baseURL: mockBaseURL,
    apiKey: testApiKey,
    fetch: mockFetch,
    timeout: 5000,
  });

  it('prefers the current JWT when both credentials exist', async () => {
    mockFetch.mockResolvedValue(createMockResponse(200, {}));
    await makeRequest('/resource', 'GET', { ...context(), authToken: 'session.jwt' });
    expect(new Headers(mockFetch.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer session.jwt'
    );
  });

  it('omits all credentials for a public operation even with a session and API key', async () => {
    mockFetch.mockResolvedValue(createMockResponse(200, {}));
    await makeRequest('/auth/login', 'POST', {
      ...context(),
      authToken: 'session.jwt',
      authentication: 'none',
    });
    expect(new Headers(mockFetch.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
  });

  it('does not send undocumented or browser-forbidden headers', async () => {
    mockFetch.mockResolvedValue(createMockResponse(200, {}));
    await makeRequest('/resource', 'GET', context());
    expect(Object.keys(mockFetch.mock.calls[0][1]?.headers ?? {}).sort()).toEqual([
      'Accept',
      'Authorization',
    ]);
  });

  it('rejects a JWT-only operation without a JWT before making a request', async () => {
    await expect(
      makeRequest('/account', 'GET', { ...context(), authentication: 'bearer' })
    ).rejects.toThrow(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects protected operations without either credential before making a request', async () => {
    await expect(
      makeRequest('/resource', 'GET', { ...context(), apiKey: undefined })
    ).rejects.toThrow(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([false, 0, null])('serializes a present falsy JSON body %s', async (body) => {
    mockFetch.mockResolvedValue(createMockResponse(200, {}));
    await makeRequest('/resource', 'POST', context(), undefined, body);
    expect(mockFetch.mock.calls[0][1]?.body).toBe(JSON.stringify(body));
    expect(new Headers(mockFetch.mock.calls[0][1]?.headers).get('Content-Type')).toBe(
      'application/json'
    );
  });

  it('retains the base path and encodes query values', async () => {
    mockFetch.mockResolvedValue(createMockResponse(200, {}));
    await makeRequest(
      '/resource',
      'GET',
      { ...context(), baseURL: 'https://example.com/nebula/' },
      { name: 'A&B / C', enabled: false, offset: 0 }
    );
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/nebula/resource');
    expect(url.searchParams.get('name')).toBe('A&B / C');
    expect(url.searchParams.get('enabled')).toBe('false');
    expect(url.searchParams.get('offset')).toBe('0');
  });

  it('rejects malformed successful JSON with its parse cause', async () => {
    mockFetch.mockResolvedValue(createMockResponse(200, '{broken'));
    try {
      await makeRequest('/resource', 'GET', context());
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).cause).toBeInstanceOf(SyntaxError);
    }
  });

  it('rejects HTML success responses instead of presenting them as API data', async () => {
    mockFetch.mockResolvedValue(createMockResponse(200, '<html>Proxy</html>', 'text/html'));
    await expect(makeRequest('/resource', 'GET', context())).rejects.toThrow(NetworkError);
  });

  it('accepts JSON media types with a suffix', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse(200, { ok: true }, 'application/vnd.nebula+json; charset=utf-8')
    );
    await expect(makeRequest('/resource', 'GET', context())).resolves.toEqual({ ok: true });
  });

  it.each([
    ['{broken', 'application/json'],
    ['<html>Unavailable</html>', 'text/html'],
  ])('retains HTTP error status with an unreadable error payload', async (body, contentType) => {
    mockFetch.mockResolvedValue(createMockResponse(503, body, contentType));
    await expect(makeRequest('/resource', 'GET', context())).rejects.toMatchObject({
      name: 'ServerError',
      statusCode: 503,
    });
  });

  it('preserves an API error message and details', async () => {
    const payload = { error: 'Already exists', details: { field: 'name' } };
    mockFetch.mockResolvedValue(createMockResponse(409, payload));
    await expect(makeRequest('/resource', 'POST', context())).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
      message: payload.error,
      errorData: payload,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('accepts the backend message-shaped error response', async () => {
    mockFetch.mockResolvedValue(createMockResponse(404, { message: 'User not found', user: null }));
    await expect(makeRequest('/user/missing', 'GET', context())).rejects.toMatchObject({
      name: 'NotFoundError',
      message: 'User not found',
    });
  });

  it('keeps the timeout active until the response body has been read', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(async (_url, init) => {
      const response = createMockResponse(200, {});
      response.text = () =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        );
      return response;
    });
    const request = makeRequest('/slow-body', 'GET', { ...context(), timeout: 100 });
    const assertion = expect(request).rejects.toThrow(TimeoutError);
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears deadlines after success and failure', async () => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValueOnce(createMockResponse(200, {}));
    await makeRequest('/resource', 'GET', context());
    expect(jest.getTimerCount()).toBe(0);
    mockFetch.mockRejectedValueOnce(new Error('Offline'));
    await expect(makeRequest('/resource', 'GET', context())).rejects.toThrow(NetworkError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not retry a failed write', async () => {
    const cause = new Error('Connection dropped');
    mockFetch.mockRejectedValue(cause);
    await expect(
      makeRequest('/resource', 'POST', context(), undefined, { name: 'item' })
    ).rejects.toMatchObject({ name: 'NetworkError', cause });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
