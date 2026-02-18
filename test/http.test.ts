// test/http.test.ts
import { makeRequest } from '../src/http';
import { NebulaClientConfig } from '../src/types';
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
} from '../src/errors';

const mockBaseURL = 'http://testhost.com';
const testApiKey = 'neb_testkey_for_http';

function createMockResponse(status: number, body: any = null, contentType = 'application/json'): Response {
  const bodyStr = body === null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: new Headers({ 'Content-Type': contentType }),
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token');
      return body;
    },
    text: async () => bodyStr,
    clone: function () { return createMockResponse(status, body, contentType); },
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    bytes: async () => new Uint8Array(),
  } as Response;
}

function mockContext(fetchFn: jest.Mock): Required<NebulaClientConfig> {
  return {
    baseURL: mockBaseURL,
    apiKey: testApiKey,
    timeout: 5000,
    fetch: fetchFn as any,
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

    const result = await makeRequest<typeof expected>('/resource', 'POST', mockContext(mockFetch), undefined, body);
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
    [404, NotFoundError, 'Not Found'],
    [429, RateLimitError, 'Too Many Requests'],
    [500, ServerError, 'Internal Server Error'],
    [503, ServerError, 'Service Unavailable'],
  ])('should throw correct error for status %i', async (status, ExpectedError, apiMsg) => {
    mockFetch.mockResolvedValueOnce(createMockResponse(status, { error: apiMsg }));

    try {
      await makeRequest('/error', 'GET', mockContext(mockFetch));
      throw new Error('Should have thrown');
    } catch (error: any) {
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
    mockFetch.mockImplementationOnce(() => new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      }, 60);
    }));

    await expect(makeRequest('/slow', 'GET', ctx)).rejects.toThrow(TimeoutError);
  });

  it('should throw ApiError for unhandled status codes (e.g., 418)', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(418, { error: "I'm a teapot" }));

    try {
      await makeRequest('/teapot', 'GET', mockContext(mockFetch));
      throw new Error('Should have thrown');
    } catch (error: any) {
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
