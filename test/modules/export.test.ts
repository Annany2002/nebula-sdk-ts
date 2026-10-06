import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ForbiddenError,
  NebulaError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from '../../src/errors';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const bytes = Uint8Array.from([...new TextEncoder().encode('SQLite format 3\0'), 0, 255, 128, 1]);
const dump = {
  sql: "CREATE TABLE items (label TEXT);\nINSERT INTO items VALUES ('O''Brien');",
  filename: 'app.sql',
};

function snapshot(): Response {
  return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
}

beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});
afterEach(() => jest.useRealTimers());

describe('ExportModule', () => {
  it('preserves the SQL JSON envelope and original SQL text', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, dump));
    expect(await client.exports.sql('app')).toEqual(dump);
    expect(getLastRequest(mockFetch)).toEqual({
      url: 'http://api.nebula-test.com/api/v1/databases/app/export/sql',
      method: 'GET',
      body: undefined,
      headers: { Accept: 'application/json', Authorization: 'ApiKey neb_testkey' },
    });
  });

  it('preserves binary bytes and derives the filename without requiring exposed headers', async () => {
    mockFetch.mockResolvedValueOnce(snapshot());
    expect(await client.exports.sqlite('app')).toEqual({ data: bytes, filename: 'app.db' });
    expect(getLastRequest(mockFetch)).toEqual({
      url: 'http://api.nebula-test.com/api/v1/databases/app/export/sqlite',
      method: 'GET',
      body: undefined,
      headers: { Accept: 'application/octet-stream', Authorization: 'ApiKey neb_testkey' },
    });
  });

  describe.each(['sql', 'sqlite'] as const)('%s export', (format) => {
    const response = () => (format === 'sql' ? mockResponse(200, dump) : snapshot());

    it('encodes the database name as one path segment', async () => {
      mockFetch.mockResolvedValueOnce(response());
      await client.exports[format]('app ?#');
      expect(getLastRequest(mockFetch).url).toBe(
        `http://api.nebula-test.com/api/v1/databases/app%20%3F%23/export/${format}`
      );
    });

    it('uses updated JWT credentials and returns to the scoped key after clearing', async () => {
      mockFetch.mockImplementation(async () => response());
      for (const token of ['first.jwt', 'second.jwt', null]) {
        client.setAuthToken(token);
        await client.exports[format]('app');
        expect(getLastRequest(mockFetch).headers.Authorization).toBe(
          token ? `Bearer ${token}` : 'ApiKey neb_testkey'
        );
      }
    });

    it('rejects missing credentials before sending a request', async () => {
      const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
      await expect(anonymous.exports[format]('app')).rejects.toBeInstanceOf(AuthError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(['', ' \t\n', null, undefined, 42])(
      'rejects invalid database name %j locally',
      async (dbName) => {
        await expect(client.exports[format](dbName as unknown as string)).rejects.toBeInstanceOf(
          NebulaError
        );
        expect(mockFetch).not.toHaveBeenCalled();
      }
    );

    it.each([
      [400, BadRequestError],
      [401, AuthError],
      [403, ForbiddenError],
      [404, NotFoundError],
      [429, RateLimitError],
      [500, ServerError],
    ])('maps HTTP %i without retry or credential fallback', async (status, ErrorType) => {
      client.setAuthToken('rejected.jwt');
      mockFetch.mockResolvedValueOnce(mockResponse(status as number, { error: 'Export rejected' }));
      await expect(client.exports[format]('app')).rejects.toMatchObject({
        name: ErrorType.name,
        message: 'Export rejected',
        statusCode: status,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer rejected.jwt');
    });
  });

  it.each(['', 'SQLite format 3', '<html>Proxy page</html>', '{"error":"not a database"}'])(
    'rejects incomplete or invalid snapshot headers %j',
    async (body) => {
      mockFetch.mockResolvedValueOnce(new Response(body));
      await expect(client.exports.sqlite('app')).rejects.toBeInstanceOf(NetworkError);
    }
  );

  it('retains HTTP errors when a binary download receives an HTML error body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('<html>Offline</html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    await expect(client.exports.sqlite('app')).rejects.toMatchObject({
      name: 'ServerError',
      statusCode: 503,
    });
  });

  it('preserves body-read failures and clears the deadline', async () => {
    jest.useFakeTimers();
    const cause = new Error('Download interrupted');
    const result = snapshot();
    result.arrayBuffer = async () => {
      throw cause;
    };
    mockFetch.mockResolvedValueOnce(result);
    await expect(client.exports.sqlite('app')).rejects.toMatchObject({
      name: 'NetworkError',
      cause,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the deadline active during binary consumption', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(async (_url, init) => {
      const result = snapshot();
      result.arrayBuffer = () =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        );
      return result;
    });
    const download = client.exports.sqlite('app');
    const assertion = expect(download).rejects.toBeInstanceOf(TimeoutError);
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
