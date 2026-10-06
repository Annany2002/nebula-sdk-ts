import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NebulaError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../../src/errors';
import { CreateIndexPayload, CreateIndexResponse, DropIndexResponse } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';
const { client, mockFetch } = createTestClient();
const payload: CreateIndexPayload = {
  name: 'idx_orders_customer',
  table_name: 'orders',
  columns: ['customer', 'region'],
  unique: true,
};
const created: CreateIndexResponse = {
  message: 'Index created successfully',
  db_name: 'app',
  index: {
    name: payload.name,
    tableName: 'orders',
    unique: true,
    sql: 'CREATE UNIQUE INDEX "idx_orders_customer" ON "orders" ("customer", "region")',
  },
};
const dropped: DropIndexResponse = {
  message: 'Index dropped successfully',
  db_name: 'app',
  index_name: payload.name,
};
beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});

describe('Typed index management', () => {
  it('sends the ordered payload without changing SQL metadata or adding unsupported options', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    expect(await client.objects.createIndex('app', payload)).toEqual(created);
    expect(getLastRequest(mockFetch)).toMatchObject({
      url: 'http://api.nebula-test.com/api/v1/databases/app/indexes',
      method: 'POST',
      body: payload,
      headers: { Authorization: 'ApiKey neb_testkey' },
    });
  });
  it('leaves omitted uniqueness omitted so the server applies its default', async () => {
    const ordinary = { name: 'idx_label', table_name: 'items', columns: ['label'] };
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    await client.objects.createIndex('app', ordinary);
    expect(getLastRequest(mockFetch).body).toEqual(ordinary);
  });
  it('encodes both database and legacy index names and sends no DELETE body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    await client.objects.createIndex('app ?#', payload);
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/indexes'
    );
    mockFetch.mockResolvedValueOnce(mockResponse(200, dropped));
    expect(await client.objects.dropIndex('app ?#', 'legacy "/?#')).toEqual(dropped);
    expect(getLastRequest(mockFetch)).toMatchObject({
      url: 'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/indexes/legacy%20%22%2F%3F%23',
      method: 'DELETE',
      body: undefined,
    });
  });
  it('resolves the current JWT for every write and restores API-key auth when cleared', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, dropped));
    client.setAuthToken('first.jwt');
    await client.objects.createIndex('app', payload);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer first.jwt');
    client.setAuthToken('rotated.jwt');
    await client.objects.dropIndex('app', payload.name);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer rotated.jwt');
    client.setAuthToken(null);
    await client.objects.dropIndex('app', payload.name);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('ApiKey neb_testkey');
  });
  it('requires credentials for both mutations before fetch', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.objects.createIndex('app', payload)).rejects.toBeInstanceOf(AuthError);
    await expect(anonymous.objects.dropIndex('app', payload.name)).rejects.toBeInstanceOf(
      AuthError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['', ' \t', undefined, null, 42])(
    'rejects missing database names %j before either write',
    async (name) => {
      await expect(
        client.objects.createIndex(name as unknown as string, payload)
      ).rejects.toBeInstanceOf(NebulaError);
      await expect(
        client.objects.dropIndex(name as unknown as string, payload.name)
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    undefined,
    null,
    {},
    { ...payload, name: '' },
    { ...payload, name: 1 },
    { ...payload, table_name: '' },
    { ...payload, table_name: null },
    { ...payload, columns: [] },
    { ...payload, columns: 'customer' },
    { ...payload, columns: [''] },
    { ...payload, columns: [1] },
    { ...payload, columns: Array(65).fill('customer') },
    { ...payload, unique: 'true' },
  ])('rejects incomplete creation payloads %j before fetch', async (value) => {
    await expect(
      client.objects.createIndex('app', value as unknown as CreateIndexPayload)
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['', undefined, null, 42])(
    'rejects missing index names %j before DELETE',
    async (name) => {
      await expect(
        client.objects.dropIndex('app', name as unknown as string)
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  describe.each(['create', 'drop'] as const)('%s failures', (operation) => {
    it.each([
      [400, BadRequestError],
      [401, AuthError],
      [403, ForbiddenError],
      [404, NotFoundError],
      [409, ConflictError],
      [429, RateLimitError],
      [500, ServerError],
    ])('maps HTTP %i without retry or credential fallback', async (status, ErrorType) => {
      client.setAuthToken('invalid.jwt');
      mockFetch.mockResolvedValueOnce(
        mockResponse(status as number, { error: 'Rejected index mutation' })
      );
      const action =
        operation === 'create'
          ? client.objects.createIndex('app', payload)
          : client.objects.dropIndex('app', payload.name);
      await expect(action).rejects.toBeInstanceOf(ErrorType);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer invalid.jwt');
    });
  });
});
