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
import { DatabaseAnalytics } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const empty: DatabaseAnalytics = {
  totalRequests: 0,
  successRate: 100,
  timeframe: '24h',
  services: [],
  advisor: [],
};

beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});

describe('AnalyticsModule', () => {
  it('retrieves the raw report with service history and optional table findings', async () => {
    const report: DatabaseAnalytics = {
      totalRequests: 10,
      successRate: 80,
      timeframe: '24h',
      services: [
        {
          name: 'SQL Engine',
          requests: 10,
          warnings: 1,
          errors: 1,
          history: [{ timestamp: '14:00', requests: 10, warnings: 1, errors: 1 }],
        },
      ],
      advisor: [
        {
          id: 'missing-pk-items',
          category: 'SECURITY',
          severity: 'CRITICAL',
          title: 'No primary key',
          description: 'Rows cannot be uniquely identified.',
          tableName: 'items',
          suggestion: 'Add a primary key.',
        },
        {
          id: 'journal-mode-wal',
          category: 'PERFORMANCE',
          severity: 'WARNING',
          title: 'Journal mode',
          description: 'WAL is recommended.',
          suggestion: 'Enable WAL.',
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, report));
    expect(await client.analytics.get('app')).toEqual(report);
    const request = getLastRequest(mockFetch);
    expect(request.url).toBe('http://api.nebula-test.com/api/v1/databases/app/analytics');
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
    expect(request.headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('preserves empty arrays and the backend success-rate convention', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    expect(await client.analytics.get('app')).toEqual(empty);
  });

  it('encodes database names without adding query parameters', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    await client.analytics.get('app ?#');
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/analytics'
    );
  });

  it('uses the current JWT and restores API-key access when the session is cleared', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, empty));
    client.setAuthToken('first.jwt');
    await client.analytics.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer first.jwt');
    client.setAuthToken('second.jwt');
    await client.analytics.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer second.jwt');
    client.setAuthToken(null);
    await client.analytics.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('rejects missing credentials before fetch', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.analytics.get('app')).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['', ' \t\n', undefined, null, 42])(
    'rejects invalid database names %j before fetch',
    async (dbName) => {
      await expect(client.analytics.get(dbName as unknown as string)).rejects.toBeInstanceOf(
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
      mockResponse(status as number, { error: 'Rejected analytics request' })
    );
    await expect(client.analytics.get('app')).rejects.toBeInstanceOf(ErrorType);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer invalid.jwt');
  });
});
