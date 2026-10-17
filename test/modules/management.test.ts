import { NebulaClient } from '../../src/client';
import {
  ApiError,
  AuthError,
  ConflictError,
  ForbiddenError,
  NebulaError,
  NetworkError,
  RequestAbortedError,
  TimeoutError,
} from '../../src/errors';
import {
  AdminUserListOptions,
  AdminAuditListOptions,
  ManagementRequestOptions,
} from '../../src/types';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const user = {
  user_id: 'owner',
  username: 'builder',
  email: 'owner@example.test',
  created_at: '2026-10-17T09:00:00Z',
  email_verified: false,
  verification_required: false,
  role: 'user',
  status: 'active',
  database_count: 1,
};
const event = {
  event_id: 2,
  actor_user_id: 'deleted-admin',
  target_user_id: 'owner',
  action: 'suspend',
  created_at: user.created_at,
};
const pagination = { total: 1, limit: 20, offset: 0 };
const summary = { database_count: 1, active_api_key_count: 1, ready_backup_count: 2 };
const stats = {
  total_users: 1,
  total_databases: 1,
  total_tables: 3,
  databases_counted: 1,
  databases_unavailable: 0,
};

describe('Account and administration contracts', () => {
  const { client, mockFetch } = createTestClient();
  beforeEach(() => {
    mockFetch.mockReset();
    client.setAuthToken('owner.jwt');
    mockFetch.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/summary')) return mockResponse(200, { summary });
      if (path.endsWith('/stats')) return mockResponse(200, { stats });
      if (path.endsWith('/audit-events')) return mockResponse(200, { events: [event], pagination });
      if (path.endsWith('/users')) return mockResponse(200, { users: [user], pagination });
      return mockResponse(200, {
        user: { ...user, status: path.endsWith('/suspend') ? 'suspended' : 'active' },
      });
    });
  });
  const operations = [
    ['summary', () => client.account.getSummary()],
    ['users', () => client.admin.listUsers()],
    ['user', () => client.admin.getUser('owner')],
    ['stats', () => client.admin.getStats()],
    ['audit', () => client.admin.listAuditEvents()],
    ['suspend', () => client.admin.suspendUser('owner')],
    ['activate', () => client.admin.activateUser('owner')],
  ] as const;

  it.each(operations)(
    '%s uses the latest JWT and non-caching credential-safe transport',
    async (_label, call) => {
      client.setAuthToken('fresh.jwt');
      await call();
      expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer fresh.jwt');
      expect(mockFetch.mock.calls[0][1]).toMatchObject({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );
  it.each(operations)('%s never substitutes an API key for a missing JWT', async (_label, call) => {
    client.setAuthToken(null);
    await expect(call()).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('supports owner JWT clients without any configured API key', async () => {
    const owner = new NebulaClient({ baseURL: 'http://localhost', fetch: mockFetch });
    owner.setAuthToken('owner.jwt');
    await expect(owner.account.getSummary()).resolves.toEqual({ summary });
  });
  it('keeps summary owner scoped with no query or body', async () => {
    await expect(client.account.getSummary()).resolves.toEqual({ summary });
    const request = getLastRequest(mockFetch);
    expect(request.url).toBe('http://api.nebula-test.com/api/v1/account/summary');
    expect(request.body).toBeUndefined();
  });
  it.each(['user', 'admin', undefined] as const)(
    'preserves profile role %s without guessing legacy membership',
    async (role) => {
      const profile = {
        userId: 'owner',
        username: user.username,
        email: user.email,
        createdAt: user.created_at,
        ...(role && { role }),
      };
      mockFetch.mockResolvedValue(
        mockResponse(200, { ...profile, password_hash: 'private', session_version: 2 })
      );
      await expect(client.auth.getMe()).resolves.toEqual(profile);
      mockFetch.mockResolvedValue(mockResponse(200, { message: 'Updated', user: profile }));
      await expect(client.auth.updateProfile({ username: user.username })).resolves.toEqual({
        message: 'Updated',
        user: profile,
      });
    }
  );
  it('rejects unknown profile roles', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        userId: 'owner',
        username: 'builder',
        email: user.email,
        createdAt: user.created_at,
        role: 'root',
      })
    );
    await expect(client.auth.getMe()).rejects.toBeInstanceOf(NetworkError);
  });
  it('encodes literal search and combines role/status filters without mutating options', async () => {
    const filters = Object.freeze({
      q: 'build_%\\&team',
      role: 'user',
      status: 'active',
      limit: 1,
      offset: 0,
    } as const);
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { users: [user], pagination: { total: 1, limit: 1, offset: 0 } })
    );
    await client.admin.listUsers(filters);
    const request = new URL(getLastRequest(mockFetch).url);
    expect(request.searchParams.get('q')).toBe(filters.q);
    expect(request.searchParams.get('role')).toBe('user');
    expect(request.searchParams.get('status')).toBe('active');
    expect(request.searchParams.get('limit')).toBe('1');
    expect(filters.q).toBe('build_%\\&team');
  });
  it.each(['💜'.repeat(100), '   '])(
    'accepts Unicode code points and whitespace-only search',
    async (q) => {
      await client.admin.listUsers({ q });
      expect(new URL(getLastRequest(mockFetch).url).searchParams.get('q')).toBe(q);
    }
  );
  it.each(
    [
      null,
      [],
      { token: 'private' },
      { limit: null },
      { offset: null },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: '20' },
      { offset: -1 },
      { offset: 1_000_001 },
      { offset: Infinity },
      { q: '' },
      { q: '💜'.repeat(101) },
      { q: 'bad\nquery' },
      { q: '\u0085' },
      { q: '\ud800' },
      { role: 'owner' },
      { status: 'disabled' },
    ].map((value) => [value])
  )('rejects invalid user filters before fetch: %#', async (filters) => {
    await expect(
      client.admin.listUsers(filters as unknown as AdminUserListOptions)
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'delete' },
    { actor_user_id: '' },
    { target_user_id: 'a'.repeat(129) },
    { q: 'unsupported' },
    { actor_user_id: '💜'.repeat(128), target_user_id: '💜'.repeat(128) },
  ])('rejects invalid audit filters and oversized encoded queries: %#', async (filters) => {
    await expect(
      client.admin.listAuditEvents(filters as AdminAuditListOptions)
    ).rejects.toBeInstanceOf(NebulaError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('preserves exact audit IDs and filters', async () => {
    await expect(
      client.admin.listAuditEvents({
        actor_user_id: event.actor_user_id,
        target_user_id: event.target_user_id,
        action: 'suspend',
      })
    ).resolves.toEqual({ events: [event], pagination });
    const params = new URL(getLastRequest(mockFetch).url).searchParams;
    expect(params.get('actor_user_id')).toBe(event.actor_user_id);
    expect(params.get('target_user_id')).toBe('owner');
  });
  it('preserves empty and exhausted pages', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { users: [], pagination: { total: 1, offset: 1000000, limit: 100 } })
    );
    await expect(client.admin.listUsers({ limit: 100, offset: 1000000 })).resolves.toHaveProperty(
      'users',
      []
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { events: [], pagination: { ...pagination, total: 0 } })
    );
    await expect(client.admin.listAuditEvents()).resolves.toHaveProperty('events', []);
  });
  it.each([
    { users: [user], pagination: { ...pagination, limit: 10 } },
    { users: [user], pagination: { ...pagination, offset: 1 } },
    { users: [], pagination },
    { users: [user], pagination: { ...pagination, total: 0 } },
    { users: [{ ...user, role: 'root' }], pagination },
    { users: [{ ...user, database_count: -1 }], pagination },
    { users: [user, user], pagination: { ...pagination, total: 2 } },
  ])('rejects inconsistent user pages: %#', async (body) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, body));
    await expect(client.admin.listUsers()).rejects.toBeInstanceOf(NetworkError);
  });
  it('rejects responses that ignore filters', async () => {
    await expect(client.admin.listUsers({ role: 'admin' })).rejects.toBeInstanceOf(NetworkError);
    await expect(client.admin.listAuditEvents({ action: 'activate' })).rejects.toBeInstanceOf(
      NetworkError
    );
  });
  it.each(
    [
      [{ ...event, event_id: 0 }],
      [event, event],
      [event, { ...event, event_id: 3 }],
      [{ ...event, action: 'delete' }],
    ].map((value) => [value])
  )('rejects malformed or unordered audit events: %#', async (events) => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { events, pagination: { ...pagination, total: events.length } })
    );
    await expect(client.admin.listAuditEvents()).rejects.toBeInstanceOf(NetworkError);
  });
  it.each(['', '.', '..', 'x\u0000y', '\udc00', 'a'.repeat(129)])(
    'rejects unsafe path IDs: %#',
    async (id) => {
      await expect(client.admin.getUser(id)).rejects.toBeInstanceOf(NebulaError);
      await expect(client.admin.suspendUser(id)).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it('encodes account path segments and validates the returned identity', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { user: { ...user, user_id: 'a/b?c#d' } }));
    await client.admin.getUser('a/b?c#d');
    expect(getLastRequest(mockFetch).url).toBe(
      'http://api.nebula-test.com/api/v1/admin/users/a%2Fb%3Fc%23d'
    );
    await expect(client.admin.getUser('different')).rejects.toBeInstanceOf(NetworkError);
  });
  it.each([
    null,
    {},
    { ...summary, database_count: -1 },
    { ...summary, ready_backup_count: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed summary counts: %#', async (value) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { summary: value }));
    await expect(client.account.getSummary()).rejects.toBeInstanceOf(NetworkError);
  });
  it('preserves unavailable tables as null and rejects misleading completeness', async () => {
    const incomplete = {
      ...stats,
      total_tables: null,
      databases_counted: 0,
      databases_unavailable: 1,
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, { stats: incomplete }));
    await expect(client.admin.getStats()).resolves.toEqual({ stats: incomplete });
    for (const invalid of [
      { ...incomplete, total_tables: 0 },
      { ...stats, total_tables: null },
      { ...stats, databases_counted: 0 },
    ]) {
      mockFetch.mockResolvedValueOnce(mockResponse(200, { stats: invalid }));
      await expect(client.admin.getStats()).rejects.toBeInstanceOf(NetworkError);
    }
  });
  it('projects only safe metadata from success responses', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        user: { ...user, password_hash: 'private', key: 'private', file_path: '/private/path' },
      })
    );
    await expect(client.admin.getUser('owner')).resolves.toEqual({ user });
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { events: [{ ...event, email: 'private' }], pagination })
    );
    await expect(client.admin.listAuditEvents()).resolves.toEqual({ events: [event], pagination });
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { summary: { ...summary, token: 'private' } })
    );
    await expect(client.account.getSummary()).resolves.toEqual({ summary });
  });
  it('writes only the intended action, sends no body and requires the matching resulting status', async () => {
    await expect(client.admin.suspendUser('owner')).resolves.toHaveProperty(
      'user.status',
      'suspended'
    );
    expect(getLastRequest(mockFetch)).toMatchObject({
      method: 'PUT',
      url: 'http://api.nebula-test.com/api/v1/admin/users/owner/suspend',
      body: undefined,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce(mockResponse(200, { user }));
    await expect(client.admin.suspendUser('owner')).rejects.toBeInstanceOf(NetworkError);
  });
  it.each([
    [403, 'admin_required', ForbiddenError],
    [409, 'admin_account_protected', ConflictError],
    [401, 'session_revoked', AuthError],
    [503, 'admin_unavailable', ApiError],
  ] as const)(
    'preserves status %s and code %s without retrying or changing sessions',
    async (status, code, type) => {
      mockFetch.mockResolvedValueOnce(mockResponse(status, { error: code, code }));
      const error = await client.admin.suspendUser('owner').catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(type);
      expect(error).toMatchObject({ statusCode: status, errorData: { code } });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(client.getAuthToken()).toBe('owner.jwt');
    }
  );
  it.each([null, { timeout: 0 }, { signal: {} }, { user_id: 'other' }])(
    'rejects invalid request options: %#',
    async (options) => {
      await expect(
        client.account.getSummary(options as unknown as ManagementRequestOptions)
      ).rejects.toBeInstanceOf(NebulaError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it('does not start a pre-cancelled call', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(client.admin.listUsers({}, { signal: controller.signal })).rejects.toBeInstanceOf(
      RequestAbortedError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('covers response consumption with the deadline and never retries timed-out writes', async () => {
    // Fetch implementations must honor abort while reading. This fixture rejects the body read on abort.
    mockFetch.mockImplementationOnce(async (_input, options) => {
      const response = mockResponse(200, {});
      response.text = () =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        );
      return response;
    });
    await expect(client.admin.suspendUser('owner', { timeout: 15 })).rejects.toBeInstanceOf(
      TimeoutError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
