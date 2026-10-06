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
import { SchemaDiagram } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const empty: SchemaDiagram = { tables: [], totalTables: 0, totalForeignKeys: 0 };

beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});

describe('DiagramModule', () => {
  it('retrieves raw schema data and preserves numeric flags, defaults, and foreign keys', async () => {
    const diagram: SchemaDiagram = {
      tables: [
        {
          name: 'items',
          columns: [
            { cid: '0', name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
            { cid: '1', name: 'parent_id', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 },
          ],
          foreignKeys: [
            {
              id: 0,
              seq: 0,
              table: 'parents',
              from: 'parent_id',
              to: 'id',
              onUpdate: 'NO ACTION',
              onDelete: 'CASCADE',
            },
          ],
          rowCount: 2,
          sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL DEFAULT 0 REFERENCES parents(id) ON DELETE CASCADE)',
        },
      ],
      totalTables: 1,
      totalForeignKeys: 1,
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, diagram));
    expect(await client.diagrams.get('app')).toEqual(diagram);
    const request = getLastRequest(mockFetch);
    expect(request.url).toBe('http://api.nebula-test.com/api/v1/databases/app/diagram');
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
    expect(request.headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('preserves the empty database response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    expect(await client.diagrams.get('app')).toEqual(empty);
  });

  it('encodes the database path without introducing query parameters', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, empty));
    await client.diagrams.get('app ?#');
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/diagram'
    );
  });

  it('uses the current JWT and restores API-key access when the session is cleared', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, empty));
    client.setAuthToken('first.jwt');
    await client.diagrams.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer first.jwt');
    client.setAuthToken('second.jwt');
    await client.diagrams.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer second.jwt');
    client.setAuthToken(null);
    await client.diagrams.get('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('rejects missing credentials before fetch', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.diagrams.get('app')).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['', ' \t\n', undefined, null, 42])(
    'rejects invalid database names %j before fetch',
    async (dbName) => {
      await expect(client.diagrams.get(dbName as unknown as string)).rejects.toBeInstanceOf(
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
  ])('maps HTTP %i errors without retrying or changing credentials', async (status, ErrorType) => {
    client.setAuthToken('invalid.jwt');
    mockFetch.mockResolvedValueOnce(
      mockResponse(status as number, { error: 'Rejected diagram request' })
    );
    await expect(client.diagrams.get('app')).rejects.toBeInstanceOf(ErrorType);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer invalid.jwt');
  });
});
