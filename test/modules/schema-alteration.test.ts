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
import { AlterTableOperation, AlterTablePayload, AlterTableResponse } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const response: AlterTableResponse = {
  message: 'Altered',
  db_name: 'app',
  table_name: 'items',
  statements: ['ALTER TABLE items ADD COLUMN stock INTEGER;'],
  schema: [{ name: 'id', type: 'INTEGER', pk: true }],
};
const actions: AlterTableOperation[] = [
  {
    action: 'add_column',
    column: {
      name: 'stock',
      type: 'INTEGER',
      not_null: true,
      default_value: '0',
      foreign_key: { target_table: 'parent', target_column: 'id', on_delete: 'RESTRICT' },
    },
  },
  { action: 'drop_column', column_name: 'obsolete' },
  { action: 'rename_column', old_name: 'stock', new_name: 'inventory' },
  { action: 'rename_table', new_table_name: 'inventory_items' },
];
beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});
describe('SchemaModule.alterTable', () => {
  it.each(actions)(
    'sends $action without altering expression strings or fields',
    async (payload) => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, response));
      expect(await client.schema.alterTable('app', 'items', payload)).toEqual(response);
      expect(getLastRequest(mockFetch)).toMatchObject({
        url: 'http://api.nebula-test.com/api/v1/databases/app/tables/items/alter',
        method: 'POST',
        body: payload,
        headers: { Authorization: 'ApiKey neb_testkey', 'Content-Type': 'application/json' },
      });
    }
  );
  it('preserves ordered batches and the final table name', async () => {
    const result = { ...response, table_name: 'inventory_items', schema: null };
    mockFetch.mockResolvedValueOnce(mockResponse(200, result));
    expect(await client.schema.alterTable('app', 'items', { operations: actions })).toEqual(result);
    expect(getLastRequest(mockFetch).body).toEqual({ operations: actions });
  });
  it('preserves a null default rather than converting it to SQL text', async () => {
    const payload: AlterTablePayload = {
      action: 'add_column',
      column: { name: 'note', type: 'TEXT', default_value: null },
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, response));
    await client.schema.alterTable('app', 'items', payload);
    expect(getLastRequest(mockFetch).body).toEqual(payload);
  });
  it('encodes both path segments', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, response));
    await client.schema.alterTable('app ?#', 'items/?#', actions[0]);
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/tables/items%2F%3F%23/alter'
    );
  });
  it('uses rotated JWTs and restores API-key access after clearing', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, response));
    for (const token of ['first.jwt', 'second.jwt', null]) {
      client.setAuthToken(token);
      await client.schema.alterTable('app', 'items', actions[0]);
      expect(getLastRequest(mockFetch).headers.Authorization).toBe(
        token ? `Bearer ${token}` : 'ApiKey neb_testkey'
      );
    }
  });
  it('rejects missing credentials locally', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.schema.alterTable('app', 'items', actions[0])).rejects.toBeInstanceOf(
      AuthError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['', ' \t\n', null, undefined, 42])(
    'rejects invalid path names %j before fetch',
    async (value) => {
      await expect(
        client.schema.alterTable(value as unknown as string, 'items', actions[0])
      ).rejects.toBeInstanceOf(NebulaError);
      await expect(
        client.schema.alterTable('app', value as unknown as string, actions[0])
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    undefined,
    {},
    { operations: [] },
    { action: 'truncate' },
    { operations: [{ action: 'truncate' }] },
  ])('rejects missing or unsupported operations %j locally', async (payload) => {
    await expect(
      client.schema.alterTable('app', 'items', payload as unknown as AlterTablePayload)
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    [400, BadRequestError],
    [401, AuthError],
    [403, ForbiddenError],
    [404, NotFoundError],
    [429, RateLimitError],
    [500, ServerError],
  ])(
    'maps HTTP %i without retrying a write or falling back to an API key',
    async (status, ErrorType) => {
      client.setAuthToken('invalid.jwt');
      mockFetch.mockResolvedValueOnce(
        mockResponse(status as number, { error: 'Alteration failed' })
      );
      await expect(client.schema.alterTable('app', 'items', actions[0])).rejects.toMatchObject({
        name: ErrorType.name,
        statusCode: status,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer invalid.jwt');
    }
  );
});
