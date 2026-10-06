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
import { DatabaseObjects } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const empty: DatabaseObjects = { indexes: [], triggers: [] };

beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});

describe('ObjectsModule', () => {
  it('retrieves index and trigger metadata without parsing or changing SQL', async () => {
    const objects: DatabaseObjects = {
      indexes: [
        {
          name: 'label_lookup',
          tableName: 'items',
          unique: true,
          sql: 'CREATE UNIQUE INDEX label_lookup ON items(label)',
        },
      ],
      triggers: [
        {
          name: 'audit_insert',
          tableName: 'items',
          sql: 'CREATE TRIGGER audit_insert AFTER INSERT ON items BEGIN INSERT INTO audit VALUES (NEW.id); END',
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, objects));
    expect(await client.objects.get('app')).toEqual(objects);
    const request = getLastRequest(mockFetch);
    expect(request.url).toBe('http://api.nebula-test.com/api/v1/databases/app/objects');
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
    expect(request.headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('preserves empty arrays', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    expect(await client.objects.get('app')).toEqual(empty);
  });

  it('encodes the database path without introducing query parameters', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    await client.objects.get('app ?#');
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/objects'
    );
  });

  it('uses the current JWT and restores API-key access when the session is cleared', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, empty));
    client.setAuthToken('first.jwt');
    await client.objects.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer first.jwt');
    client.setAuthToken('second.jwt');
    await client.objects.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer second.jwt');
    client.setAuthToken(null);
    await client.objects.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('rejects missing credentials before fetch', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.objects.get('app')).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['', ' \t\n', undefined, null, 42])(
    'rejects invalid database names %j before fetch',
    async (dbName) => {
      await expect(client.objects.get(dbName as unknown as string)).rejects.toBeInstanceOf(
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
  ])('maps HTTP %i errors without retries or credential fallback', async (status, ErrorType) => {
    client.setAuthToken('invalid.jwt');
    mockFetch.mockResolvedValueOnce(
      mockResponse(status as number, { error: 'Rejected objects request' })
    );
    await expect(client.objects.get('app')).rejects.toBeInstanceOf(ErrorType);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer invalid.jwt');
  });
});
