import { createHash } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import {
  AuthError,
  NebulaError,
  NetworkError,
  RequestAbortedError,
  TimeoutError,
} from '../../src/errors';
import { BackupListOptions, BackupRequestOptions, DatabaseBackup } from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const id = '12345678-1234-1234-1234-123456789abc';
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const bytes = new Uint8Array(512);
bytes.set(new TextEncoder().encode('SQLite format 3\0'));
const backup: DatabaseBackup = {
  backup_id: id,
  db_name: 'app',
  status: 'ready',
  size_bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  created_at: '2026-10-10T10:00:00.123456789Z',
};
const restored = {
  message: 'Backup restored successfully',
  backup_id: id,
  db_name: 'restored',
  size_bytes: 512,
};
const { client, mockFetch } = createTestClient();
const methods = ['create', 'list', 'get', 'download', 'restore', 'delete'] as const;
function call(method: (typeof methods)[number], options?: BackupRequestOptions) {
  switch (method) {
    case 'create':
      return client.backups.create('app', { backup_id: id }, options);
    case 'list':
      return client.backups.list({}, options);
    case 'get':
      return client.backups.get(id, options);
    case 'download':
      return client.backups.download(id, options);
    case 'restore':
      return client.backups.restore(id, { db_name: 'restored' }, options);
    case 'delete':
      return client.backups.delete(id, options);
  }
}
function binary(data = bytes, headers: Record<string, string> = {}) {
  return new Response(Uint8Array.from(data), {
    headers: { 'Content-Length': String(data.length), ...headers },
  });
}
beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken('owner.jwt');
});
afterEach(() => jest.useRealTimers());

describe('BackupModule contracts', () => {
  it.each([200, 201])(
    'accepts completed creation/replay HTTP %i with the caller UUID',
    async (status) => {
      mockFetch.mockResolvedValueOnce(mockResponse(status, { backup }));
      expect(await client.backups.create('app', { backup_id: id })).toEqual({ backup });
      expect(getLastRequest(mockFetch)).toMatchObject({
        url: 'http://api.nebula-test.com/api/v1/databases/app/backups',
        method: 'POST',
        body: { backup_id: id },
        headers: { Authorization: 'Bearer owner.jwt', 'Content-Type': 'application/json' },
      });
    }
  );
  it('lists account history or a deleted source with bounded pagination', async () => {
    mockFetch.mockImplementation(async (url) => {
      const params = new URL(String(url)).searchParams;
      return mockResponse(200, {
        backups: [backup],
        pagination: {
          total: 3,
          limit: Number(params.get('limit')),
          offset: Number(params.get('offset')),
        },
      });
    });
    await client.backups.list();
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/backups?limit=20&offset=0'
    );
    const result = await client.backups.list({ db_name: 'app', limit: 1, offset: 2 });
    expect(result.pagination).toEqual({ total: 3, limit: 1, offset: 2 });
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/backups?db_name=app&limit=1&offset=2'
    );
  });
  it.each(['creating', 'ready', 'deleting'] as const)(
    'preserves %s metadata without exposing server paths',
    async (status) => {
      const item = {
        ...backup,
        status,
        ...(status === 'creating' ? { size_bytes: 0, sha256: '' } : {}),
      };
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, { backup: { ...item, file_path: '/private/server/path' } })
      );
      expect(await client.backups.get(id)).toEqual({ backup: item });
    }
  );
  it('restores only the named destination and deletes with a 204 acknowledgement', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, restored));
    expect(await client.backups.restore(id, { db_name: 'restored' })).toEqual(restored);
    expect(getLastRequest(mockFetch)).toMatchObject({
      url: `http://api.nebula-test.com/api/v1/backups/${id}/restore`,
      method: 'POST',
      body: { db_name: 'restored' },
    });
    mockFetch.mockResolvedValueOnce(mockResponse(204));
    await expect(client.backups.delete(id)).resolves.toBeUndefined();
    expect(getLastRequest(mockFetch)).toMatchObject({
      url: `http://api.nebula-test.com/api/v1/backups/${id}`,
      method: 'DELETE',
    });
  });
  it('does not let caller payload mutation change the pending creation acknowledgement', async () => {
    const payload = { backup_id: id };
    mockFetch.mockImplementation(async () => {
      payload.backup_id = otherId;
      return mockResponse(201, { backup });
    });
    await expect(client.backups.create('app', payload)).resolves.toEqual({ backup });
  });
  it('buffers and verifies bytes without needing CORS-exposed length or filename headers', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { backup }));
    const response = binary();
    response.headers.delete('content-length');
    mockFetch.mockResolvedValueOnce(response);
    expect(await client.backups.download(id)).toEqual({
      backup,
      data: bytes,
      filename: `${id}.db`,
    });
    expect(getLastRequest(mockFetch)).toMatchObject({
      url: `http://api.nebula-test.com/api/v1/backups/${id}/download`,
      headers: { Authorization: 'Bearer owner.jwt', Accept: 'application/octet-stream' },
    });
  });
});

describe.each(methods)('%s backup safety', (method) => {
  it('requires JWT even when an API key is configured, with no fallback', async () => {
    client.setAuthToken(null);
    await expect(call(method)).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
    client.setAuthToken('expired.jwt');
    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Expired token' }));
    await expect(call(method)).rejects.toMatchObject({ name: 'AuthError', statusCode: 401 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer expired.jwt');
  });
  it.each([400, 403, 404, 408, 409, 413, 415, 429, 500, 503])(
    'retains HTTP %i and machine-readable code without retry',
    async (status) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(status, { error: 'Rejected', code: 'backup_busy' })
      );
      await expect(call(method)).rejects.toMatchObject({
        statusCode: status,
        errorData: { code: 'backup_busy' },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );
  it('does not send a pre-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(call(method, { signal: controller.signal })).rejects.toBeInstanceOf(
      RequestAbortedError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('preserves cancelled in-flight requests and clears timers', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    mockFetch.mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
        })
    );
    const assertion = expect(call(method, { signal: controller.signal })).rejects.toBeInstanceOf(
      RequestAbortedError
    );
    controller.abort();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('times out once and clears timers', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
        })
    );
    const assertion = expect(call(method, { timeout: 25 })).rejects.toBeInstanceOf(TimeoutError);
    await jest.advanceTimersByTimeAsync(25);
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('Backup input and response validation', () => {
  it.each(['', '../x', id.toUpperCase(), '00000000-0000-0000-0000-000000000000', null, 42])(
    'rejects UUID %j before Fetch',
    async (invalid) => {
      for (const action of [
        () => client.backups.get(invalid as string),
        () => client.backups.download(invalid as string),
        () => client.backups.delete(invalid as string),
        () => client.backups.restore(invalid as string, { db_name: 'copy' }),
        () => client.backups.create('app', { backup_id: invalid as string }),
      ])
        await expect(action()).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each(['', 'bad-name', 'with space', '../name', 'é', 'a'.repeat(65), null])(
    'rejects database name %j before Fetch',
    async (invalid) => {
      await expect(
        client.backups.create(invalid as string, { backup_id: id })
      ).rejects.toBeInstanceOf(NebulaError);
      await expect(
        client.backups.restore(id, { db_name: invalid as string })
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    [],
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: null },
    { offset: -1 },
    { offset: 1000001 },
    { offset: Infinity },
    { db_name: '' },
    { order: 'asc' },
  ])('rejects unsupported listing %j', async (filters) => {
    await expect(client.backups.list(filters as BackupListOptions)).rejects.toBeInstanceOf(
      NebulaError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { timeout: 0 },
    { timeout: Infinity },
    { timeout: 2147483648 },
    { signal: {} },
    { retry: true },
  ])('rejects unsupported request options %j', async (options) => {
    await expect(client.backups.get(id, options as BackupRequestOptions)).rejects.toBeInstanceOf(
      NebulaError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { backup_id: otherId },
    { db_name: 'wrong' },
    { status: 'creating' },
    { status: 'deleted' },
    { size_bytes: 511 },
    { size_bytes: 67108865 },
    { size_bytes: 1.5 },
    { sha256: '' },
    { sha256: 'bad' },
    { created_at: 'yesterday' },
  ])('rejects invalid or mismatched creation acknowledgement %j', async (changes) => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, { backup: { ...backup, ...changes } }));
    await expect(client.backups.create('app', { backup_id: id })).rejects.toBeInstanceOf(
      NetworkError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, { backup_id: otherId }, { db_name: 'wrong' }, { size_bytes: 0 }, { message: '' }])(
    'rejects unconfirmed restore %j without retry',
    async (changes) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(201, changes === null ? null : { ...restored, ...changes })
      );
      await expect(client.backups.restore(id, { db_name: 'restored' })).rejects.toBeInstanceOf(
        NetworkError
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );
  it('does not treat a different backup as confirmation of a pending ID', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { backup: { ...backup, backup_id: otherId } })
    );
    await expect(client.backups.get(id)).rejects.toBeInstanceOf(NetworkError);
  });
  it.each([
    { backups: [backup], pagination: { total: 1, limit: 10, offset: 0 } },
    { backups: [backup, backup], pagination: { total: 2, limit: 20, offset: 0 } },
    { backups: [{ ...backup, db_name: 'other' }], pagination: { total: 1, limit: 20, offset: 0 } },
    { backups: [], pagination: { total: -1, limit: 20, offset: 0 } },
  ])('rejects malformed history %j', async (result) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, result));
    await expect(client.backups.list({ db_name: 'app' })).rejects.toBeInstanceOf(NetworkError);
  });
  it.each(['create', 'get', 'list', 'restore', 'delete'] as const)(
    'requires the expected %s success status',
    async (method) => {
      mockFetch.mockResolvedValueOnce(mockResponse(202, { backup }));
      await expect(call(method)).rejects.toBeInstanceOf(NetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['creating', 'deleting'] as const)('does not download a %s snapshot', async (status) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { backup: { ...backup, status } }));
    await expect(client.backups.download(id)).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each(['short', 'overflow', 'hash', 'header', 'length'] as const)(
    'rejects %s download damage',
    async (failure) => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, { backup }));
      const data = Uint8Array.from(
        failure === 'short'
          ? bytes.slice(0, 511)
          : failure === 'overflow'
            ? new Uint8Array(513)
            : bytes
      );
      if (failure === 'hash') data[100] = 42;
      if (failure === 'header') data[0] = 42;
      const response = binary(data, { 'Content-Length': failure === 'length' ? '123' : '512' });
      mockFetch.mockResolvedValueOnce(response);
      await expect(client.backups.download(id)).rejects.toBeInstanceOf(NetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(getLastRequest(mockFetch).method).toBe('GET');
    }
  );
  it('cancels an overflowing custom stream and leaves no deadline timers', async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    mockFetch.mockResolvedValueOnce(mockResponse(200, { backup }));
    mockFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(513));
          },
          cancel,
        })
      )
    );
    await expect(client.backups.download(id)).rejects.toBeInstanceOf(NetworkError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('keeps cancellation and the deadline active during download consumption', async () => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValueOnce(mockResponse(200, { backup }));
    mockFetch.mockImplementationOnce(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new Error('body aborted')),
                { once: true }
              );
            },
          })
        )
    );
    const assertion = expect(client.backups.download(id, { timeout: 100 })).rejects.toBeInstanceOf(
      TimeoutError
    );
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });
  it('fails before the request if Web Crypto is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      await expect(client.backups.download(id)).rejects.toThrow(/Web Crypto/);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
  });
  it('also initializes on an owner client without an API key', () => {
    expect(new NebulaClient({ baseURL: 'https://nebula.test' }).backups).toBeDefined();
  });
});
