import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ForbiddenError,
  NebulaError,
  NotFoundError,
} from '../../src/errors';
import { SQLQueryResult } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const empty: SQLQueryResult = { rowCount: 0, rowsAffected: 0, executionMs: 0 };

beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});

describe('SQLModule', () => {
  it('posts SQL unchanged and preserves ordered tuple results and duplicate column names', async () => {
    const query = "  SELECT 1 AS value, 'one' AS value;\n";
    const expected: SQLQueryResult<[number, string]> = {
      columns: ['value', 'value'],
      rows: [[1, 'one']],
      rowCount: 1,
      rowsAffected: 0,
      executionMs: 2,
      message: '1 row(s) returned in 2ms',
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, expected));
    const result = await client.sql.execute<[number, string]>('app', query);
    expect(result).toEqual(expected);
    const request = getLastRequest(mockFetch);
    expect(request.url).toBe('http://api.nebula-test.com/api/v1/databases/app/sql');
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({ query });
    expect(request.headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('encodes the database path segment', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    await client.sql.execute('app ?#', 'SELECT 1');
    expect(getLastRequest(mockFetch).url).toContain('/databases/app%20%3F%23/sql');
  });

  it('preserves omitted rows and columns for writes', async () => {
    const expected: SQLQueryResult = {
      ...empty,
      rowsAffected: 1,
      message: 'Statement executed successfully',
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, expected));
    const result = await client.sql.execute('app', 'DELETE FROM items WHERE id = 1');
    expect(result).toEqual(expected);
    expect(result).not.toHaveProperty('rows');
    expect(result).not.toHaveProperty('columns');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves omitted rows for an empty SELECT result', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { ...empty, columns: ['id'] }));
    expect(await client.sql.execute('app', 'SELECT id FROM items WHERE 0')).toEqual({
      ...empty,
      columns: ['id'],
    });
  });

  it('uses the latest JWT and returns to API-key access after the session is cleared', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, empty));
    client.setAuthToken('first.jwt');
    await client.sql.execute('app', 'SELECT 1');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer first.jwt');
    client.setAuthToken('second.jwt');
    await client.sql.execute('app', 'SELECT 1');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer second.jwt');
    client.setAuthToken(null);
    await client.sql.execute('app', 'SELECT 1');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('rejects missing credentials before sending the SQL request', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.sql.execute('app', 'SELECT 1')).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['', ' \t\n', undefined, null, 42])(
    'rejects invalid SQL %j before fetch',
    async (query) => {
      await expect(client.sql.execute('app', query as unknown as string)).rejects.toBeInstanceOf(
        NebulaError
      );
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it.each(['', ' \t', undefined, null, 42])(
    'rejects invalid database names %j before fetch',
    async (dbName) => {
      await expect(
        client.sql.execute(dbName as unknown as string, 'SELECT 1')
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    [400, BadRequestError],
    [401, AuthError],
    [403, ForbiddenError],
    [404, NotFoundError],
  ])('maps HTTP %i errors without retrying SQL', async (status, ErrorType) => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(status as number, { error: 'Rejected SQL request' })
    );
    await expect(client.sql.execute('app', 'DELETE FROM items')).rejects.toBeInstanceOf(ErrorType);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
