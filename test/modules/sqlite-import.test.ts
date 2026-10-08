import { NebulaClient } from '../../src/client';
import {
  ApiError,
  AuthError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NebulaError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  RequestAbortedError,
  ServerError,
  TimeoutError,
} from '../../src/errors';
import { SQLiteImportPayload } from '../../src/types';
import { createTestClient, mockResponse } from '../test-helpers';

const { client, mockFetch } = createTestClient('http://example.test/nebula/');
const bytes = new Uint8Array(512);
bytes.set(new TextEncoder().encode('SQLite format 3\0'));
bytes[100] = 255;
const payload: SQLiteImportPayload = { db_name: 'restored_db', file: bytes };
const acknowledgement = {
  message: 'Database imported successfully',
  db_name: payload.db_name,
  size_bytes: bytes.length,
};

beforeEach(() => {
  mockFetch.mockReset();
  client.setAuthToken('owner.jwt');
});
afterEach(() => jest.useRealTimers());

function request(): RequestInit {
  return mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1]!;
}

async function expectUpload(expected: Uint8Array) {
  expect(mockFetch.mock.calls[0][0]).toBe(
    'http://example.test/nebula/api/v1/databases/import/sqlite'
  );
  expect(request().method).toBe('POST');
  expect(request().headers).toEqual({
    Accept: 'application/json',
    Authorization: 'Bearer owner.jwt',
  });
  const form = request().body as FormData;
  const fields: string[] = [];
  form.forEach((_value, name) => fields.push(name));
  expect(fields).toEqual(['db_name', 'file']);
  expect(form.get('db_name')).toBe(payload.db_name);
  const file = form.get('file') as File;
  expect(file.name).toBe('snapshot.db');
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(expected);
  // The native Request, rather than the SDK, provides a usable multipart boundary.
  const wire = new Request('http://example.test', request());
  expect(wire.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=.+/);
}

describe('DatabaseModule SQLite import', () => {
  it.each(['bytes', 'blob', 'file', 'buffer', 'subarray'] as const)(
    'uploads exact %s bytes using owner JWT and native multipart framing',
    async (kind) => {
      const offset = new Uint8Array(1024);
      offset.set(bytes, 137);
      const input = {
        bytes,
        blob: new Blob([bytes]),
        file: new File([bytes], '../ignored-original.sqlite'),
        buffer: Buffer.from(bytes),
        subarray: offset.subarray(137, 649),
      }[kind];
      mockFetch.mockResolvedValueOnce(mockResponse(201, acknowledgement));
      await expect(client.databases.importSQLite({ ...payload, file: input })).resolves.toEqual(
        acknowledgement
      );
      await expectUpload(bytes);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );

  it('uses the current owner token and never falls back to the API key', async () => {
    mockFetch.mockImplementation(async () => mockResponse(201, acknowledgement));
    for (const token of ['first.jwt', 'second.jwt']) {
      client.setAuthToken(token);
      await client.databases.importSQLite(payload);
      expect(new Headers(request().headers).get('Authorization')).toBe(`Bearer ${token}`);
    }
    client.setAuthToken(null);
    await expect(client.databases.importSQLite(payload)).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const anonymous = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    await expect(anonymous.databases.importSQLite(payload)).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    '',
    ' ',
    '../app',
    'app-name',
    'app.db',
    'nebula Ω',
    'x'.repeat(65),
    null,
    undefined,
    3,
  ])('rejects an invalid destination %j before sending a request', async (dbName) => {
    await expect(
      client.databases.importSQLite({ ...payload, db_name: dbName as string })
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
    '/tmp/app.db',
    new ArrayBuffer(512),
    {},
    new Uint8Array(511),
    new Blob(['CREATE TABLE items(id INTEGER);']),
    new Uint8Array(512),
  ])('rejects unsupported, short or non-SQLite inputs locally', async (file) => {
    await expect(
      client.databases.importSQLite({ ...payload, file: file as Blob })
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a snapshot larger than 64 MiB without a request', async () => {
    const file = new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]);
    await expect(client.databases.importSQLite({ ...payload, file })).rejects.toThrow('64 MiB');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648, null])(
    'rejects invalid timeout %s',
    async (timeout) => {
      await expect(
        client.databases.importSQLite(payload, { timeout: timeout as number })
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid options and signals locally', async () => {
    await expect(client.databases.importSQLite(payload, null as never)).rejects.toBeInstanceOf(
      NebulaError
    );
    await expect(
      client.databases.importSQLite(payload, { signal: {} as AbortSignal })
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [400, BadRequestError],
    [401, AuthError],
    [403, ForbiddenError],
    [404, NotFoundError],
    [408, ApiError],
    [409, ConflictError],
    [413, ApiError],
    [415, ApiError],
    [429, RateLimitError],
    [500, ServerError],
    [503, ServerError],
  ])('preserves HTTP %i without retries or credential fallback', async (status, ErrorType) => {
    mockFetch.mockResolvedValueOnce(mockResponse(status as number, { error: 'Import rejected' }));
    await expect(client.databases.importSQLite(payload)).rejects.toMatchObject({
      name: ErrorType.name,
      statusCode: status,
      message: 'Import rejected',
      errorData: { error: 'Import rejected' },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(new Headers(request().headers).get('Authorization')).toBe('Bearer owner.jwt');
  });

  it.each([
    null,
    {},
    { ...acknowledgement, db_name: 'other' },
    { ...acknowledgement, size_bytes: 513 },
    { ...acknowledgement, message: '' },
    { ...acknowledgement, message: null },
  ])('rejects incomplete or mismatched acknowledgements %j', async (response) => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, response));
    await expect(client.databases.importSQLite(payload)).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([200, 202, 204])('requires committed HTTP 201 rather than %i', async (status) => {
    mockFetch.mockResolvedValueOnce(mockResponse(status, status === 204 ? null : acknowledgement));
    await expect(client.databases.importSQLite(payload)).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['{broken', 'application/json'],
    ['<html>Proxy</html>', 'text/html'],
  ])('rejects unreadable successful responses without retrying', async (body, type) => {
    mockFetch.mockResolvedValueOnce(
      new Response(body, { status: 201, headers: { 'Content-Type': type } })
    );
    await expect(client.databases.importSQLite(payload)).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves a network failure cause and clears its timer/listener', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const cause = new Error('Connection lost after upload');
    mockFetch.mockRejectedValueOnce(cause);
    await expect(
      client.databases.importSQLite(payload, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'NetworkError', cause });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not read or upload a file when the caller signal is already aborted', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('Already stopped');
    controller.abort(reason);
    const file = new Blob([bytes]);
    const read = jest.spyOn(file, 'slice');
    await expect(
      client.databases.importSQLite({ ...payload, file }, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'RequestAbortedError', cause: reason });
    expect(read).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['upload', 'response body'] as const)(
    'cancels during %s and releases the deadline/listener',
    async (stage) => {
      jest.useFakeTimers();
      const controller = new AbortController();
      const reason = new Error('User cancelled');
      const remove = jest.spyOn(controller.signal, 'removeEventListener');
      mockFetch.mockImplementation(async (_url, init) => {
        const wait = () =>
          new Promise<never>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            })
          );
        if (stage === 'upload') return wait();
        const response = mockResponse(201, acknowledgement);
        response.text = wait;
        return response;
      });
      const upload = client.databases.importSQLite(payload, { signal: controller.signal });
      const assertion = expect(upload).rejects.toBeInstanceOf(RequestAbortedError);
      await jest.advanceTimersByTimeAsync(0);
      controller.abort(reason);
      await assertion;
      expect(request().signal?.aborted).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    }
  );

  it('uses the per-import timeout through the response body without mutating the client', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(async (_url, init) => {
      const response = mockResponse(201, acknowledgement);
      response.text = () =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('Deadline')), {
            once: true,
          })
        );
      return response;
    });
    const upload = client.databases.importSQLite(payload, { timeout: 100 });
    const assertion = expect(upload).rejects.toBeInstanceOf(TimeoutError);
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(client.getConfig().timeout).toBe(5000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains the first cancellation source when a custom fetch ignores its signal', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    let resolveFetch!: (response: Response) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    const upload = client.databases.importSQLite(payload, {
      timeout: 100,
      signal: controller.signal,
    });
    const assertion = expect(upload).rejects.toBeInstanceOf(TimeoutError);
    await jest.advanceTimersByTimeAsync(100);
    controller.abort();
    resolveFetch(mockResponse(201, acknowledgement));
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves local file read failures without uploading', async () => {
    const cause = new Error('File access lost');
    const file = new Blob([bytes]);
    jest.spyOn(file, 'slice').mockImplementation(() => {
      throw cause;
    });
    await expect(client.databases.importSQLite({ ...payload, file })).rejects.toMatchObject({
      name: 'NetworkError',
      cause,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
