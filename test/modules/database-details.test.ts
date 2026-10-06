import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ForbiddenError,
  NebulaError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../../src/errors';
import { DatabaseDetailsResponse } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const details: DatabaseDetailsResponse = {
  database: {
    databaseId: 1,
    userId: 'owner',
    dbName: 'app',
    filePath: '/data/owner/app.db',
    createdAt: '2026-10-06T12:00:00Z',
    tables: 2,
    totalRecords: 3,
    sizeBytes: 8192,
    sizeDisplay: '8.0 KB',
    apiKeyPrefix: 'neb_live_abcd',
  },
};
beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});

describe('DatabaseModule.get', () => {
  it('preserves the database envelope and detail metadata', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, details));
    expect(await client.databases.get('app')).toEqual(details);
    expect(getLastRequest(mockFetch)).toEqual({
      url: 'http://api.nebula-test.com/api/v1/databases/app',
      method: 'GET',
      body: undefined,
      headers: { Accept: 'application/json', Authorization: 'ApiKey neb_testkey' },
    });
  });
  it('preserves zero counts and an absent API-key prefix', async () => {
    const database = { ...details.database };
    delete database.apiKeyPrefix;
    const empty = {
      database: { ...database, tables: 0, totalRecords: 0, sizeBytes: 0, sizeDisplay: '0 B' },
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    expect(await client.databases.get('app')).toEqual(empty);
  });
  it('encodes the database name as a single path segment', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, details));
    await client.databases.get('app ?#');
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/databases/app%20%3F%23'
    );
  });
  it('prefers the current JWT and restores API-key access when cleared', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, details));
    for (const token of ['first.jwt', 'second.jwt', null]) {
      client.setAuthToken(token);
      await client.databases.get('app');
      expect(getLastRequest(mockFetch).headers.Authorization).toBe(
        token ? `Bearer ${token}` : 'ApiKey neb_testkey'
      );
    }
  });
  it('rejects missing credentials locally while lifecycle methods remain JWT-only', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.databases.get('app')).rejects.toBeInstanceOf(AuthError);
    await expect(client.databases.list()).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['', ' \t\n', undefined, null, 42])(
    'rejects invalid name %j before fetch',
    async (name) => {
      await expect(client.databases.get(name as unknown as string)).rejects.toBeInstanceOf(
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
  ])('maps HTTP %i without retry or fallback', async (status, ErrorType) => {
    client.setAuthToken('invalid.jwt');
    mockFetch.mockResolvedValueOnce(mockResponse(status as number, { error: 'Details rejected' }));
    await expect(client.databases.get('app')).rejects.toMatchObject({
      name: ErrorType.name,
      statusCode: status,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer invalid.jwt');
  });
});
