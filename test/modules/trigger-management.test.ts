import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NebulaError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from '../../src/errors';
import { CreateTriggerPayload, CreateTriggerResponse, DropTriggerResponse } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient();
const payload: CreateTriggerPayload = {
  name: 'audit_updates',
  table_name: 'odd "table',
  event: 'UPDATE',
  timing: 'AFTER',
  update_of: ['display name', 'region'],
  when: 'NEW.region <> OLD.region',
  body: "INSERT INTO audit VALUES (NEW.id, '変更'); -- keep SQL text\n",
};
const created: CreateTriggerResponse = {
  message: 'Trigger created successfully',
  db_name: 'app',
  trigger: {
    name: payload.name,
    tableName: payload.table_name,
    sql: 'CREATE TRIGGER "audit_updates" AFTER UPDATE ...',
  },
};
const dropped: DropTriggerResponse = {
  message: 'Trigger dropped successfully',
  db_name: 'app',
  trigger_name: payload.name,
};
beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken(null);
});

describe('Typed trigger management', () => {
  it('preserves SQL, column order, and canonical response metadata', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    expect(await client.objects.createTrigger('app', payload)).toEqual(created);
    expect(getLastRequest(mockFetch)).toMatchObject({
      url: 'http://api.nebula-test.com/api/v1/databases/app/triggers',
      method: 'POST',
      body: payload,
      headers: { Authorization: 'ApiKey neb_testkey' },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('leaves omitted optional fields omitted for server defaults', async () => {
    const minimal: CreateTriggerPayload = {
      name: 'audit_insert',
      table_name: 'items',
      event: 'INSERT',
      body: 'SELECT 1;',
    };
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    await client.objects.createTrigger('app', minimal);
    expect(getLastRequest(mockFetch).body).toEqual(minimal);
  });
  it('accepts server-compatible case/whitespace without rewriting the payload', async () => {
    const value = {
      ...payload,
      event: ' update ',
      timing: ' before ',
    } as unknown as CreateTriggerPayload;
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    await client.objects.createTrigger('app', value);
    expect(getLastRequest(mockFetch).body).toEqual(value);
  });
  it('allows empty update_of on non-UPDATE events', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    await client.objects.createTrigger('app', { ...payload, event: 'DELETE', update_of: [] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('encodes database and legacy trigger names and sends no DELETE body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, created));
    await client.objects.createTrigger('app ?#', payload);
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/triggers'
    );
    mockFetch.mockResolvedValueOnce(mockResponse(200, dropped));
    expect(await client.objects.dropTrigger('app ?#', 'legacy "/?#')).toEqual(dropped);
    expect(getLastRequest(mockFetch)).toMatchObject({
      url: 'http://api.nebula-test.com/api/v1/databases/app%20%3F%23/triggers/legacy%20%22%2F%3F%23',
      method: 'DELETE',
      body: undefined,
    });
  });
  it('resolves the current JWT on each call and restores API-key auth after clearing', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, dropped));
    client.setAuthToken('first.jwt');
    await client.objects.createTrigger('app', payload);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer first.jwt');
    client.setAuthToken('rotated.jwt');
    await client.objects.dropTrigger('app', payload.name);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer rotated.jwt');
    client.setAuthToken(null);
    await client.objects.dropTrigger('app', payload.name);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('ApiKey neb_testkey');
  });
  it('rejects missing credentials before either mutation', async () => {
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.objects.createTrigger('app', payload)).rejects.toBeInstanceOf(AuthError);
    await expect(anonymous.objects.dropTrigger('app', payload.name)).rejects.toBeInstanceOf(
      AuthError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['', ' \t', undefined, null, 42])(
    'rejects invalid database input %# before fetch',
    async (value) => {
      await expect(client.objects.createTrigger(value as string, payload)).rejects.toBeInstanceOf(
        NebulaError
      );
      await expect(
        client.objects.dropTrigger(value as string, payload.name)
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each(['', undefined, null, 42])(
    'rejects missing trigger name %# before DELETE',
    async (value) => {
      await expect(client.objects.dropTrigger('app', value as string)).rejects.toBeInstanceOf(
        NebulaError
      );
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    undefined,
    null,
    {},
    { ...payload, name: '' },
    { ...payload, name: 1 },
    { ...payload, table_name: null },
    { ...payload, table_name: '' },
    { ...payload, event: undefined },
    { ...payload, event: 'UPSERT' },
    { ...payload, timing: 'INSTEAD OF' },
    { ...payload, timing: null },
    { ...payload, update_of: 'region' },
    { ...payload, update_of: [1] },
    { ...payload, update_of: [''] },
    { ...payload, update_of: Array(65).fill('region') },
    { ...payload, event: 'INSERT' },
    { ...payload, body: undefined },
    { ...payload, body: ' \n' },
    { ...payload, body: 'SELECT 1;\0' },
    { ...payload, body: 'é'.repeat(32769) },
    { ...payload, when: null },
    { ...payload, when: 'NEW.id\0' },
    { ...payload, when: 'é'.repeat(4097) },
  ])('rejects invalid payload %# before fetch', async (value) => {
    await expect(
      client.objects.createTrigger('app', value as CreateTriggerPayload)
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('accepts exact UTF-8 limits and delegates SQL/schema checks to the backend', async () => {
    const value = { ...payload, body: 'é'.repeat(32768), when: 'é'.repeat(4096) };
    mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Invalid SQL' }));
    await expect(client.objects.createTrigger('app', value)).rejects.toBeInstanceOf(
      BadRequestError
    );
    expect(getLastRequest(mockFetch).body).toEqual(value);
  });
  describe.each(['create', 'drop'] as const)('%s failures', (operation) => {
    const action = () =>
      operation === 'create'
        ? client.objects.createTrigger('app', payload)
        : client.objects.dropTrigger('app', payload.name);
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
        mockResponse(status as number, { error: 'Rejected trigger mutation' })
      );
      await expect(action()).rejects.toBeInstanceOf(ErrorType);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer invalid.jwt');
    });
    it('retains network failures without retrying a potentially completed write', async () => {
      const cause = new Error('connection lost');
      mockFetch.mockRejectedValueOnce(cause);
      await expect(action()).rejects.toMatchObject({ name: 'NetworkError', cause });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    it('rejects malformed success JSON without retry', async () => {
      mockFetch.mockResolvedValueOnce(new Response('not json', { status: 200 }));
      await expect(action()).rejects.toBeInstanceOf(NetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    it('honors the shared deadline without retrying', async () => {
      const timed = new NebulaClient({
        baseURL: 'http://example.test',
        apiKey: 'key',
        timeout: 10,
        fetch: mockFetch,
      });
      mockFetch.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          })
      );
      await expect(
        operation === 'create'
          ? timed.objects.createTrigger('app', payload)
          : timed.objects.dropTrigger('app', payload.name)
      ).rejects.toBeInstanceOf(TimeoutError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
