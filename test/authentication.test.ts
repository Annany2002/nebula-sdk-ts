import { NebulaClient } from '../src/client';
import { AuthError } from '../src/errors';
import { createTestClient, getLastRequest, mockResponse } from './test-helpers';

const jwt = 'session.jwt.token';

describe('Endpoint authentication policy', () => {
  const { client, mockFetch } = createTestClient();
  beforeEach(() => {
    mockFetch.mockReset();
    client.setAuthToken(jwt);
    mockFetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/auth/signup'))
        return mockResponse(201, { message: 'Created', user_id: 'current-user' });
      if (String(url).endsWith('/api/v1/account/user/me') && init?.method === 'PUT') {
        return mockResponse(200, {
          message: 'Updated',
          user: {
            userId: 'current-user',
            username: 'builder',
            email: 'builder@example.test',
            createdAt: '2026-10-01',
          },
        });
      }
      if (String(url).endsWith('/api/v1/account/user/me')) {
        return mockResponse(200, {
          userId: 'current-user',
          username: 'builder',
          email: 'builder@example.test',
          createdAt: '2026-10-01',
        });
      }
      return mockResponse(200, {});
    });
  });

  it.each([
    () =>
      client.auth.signup({
        username: 'builder',
        email: 'builder@example.test',
        password: 'secret-password',
      }),
    () => client.auth.login({ email: 'builder@example.test', password: 'secret-password' }),
  ])('public authentication does not disclose existing credentials', async (operation) => {
    await operation();
    expect(getLastRequest(mockFetch).headers.Authorization).toBeUndefined();
    expect(client.getAuthToken()).toBe(jwt);
  });

  const accountOperations = [
    () => client.auth.getMe(),
    () => client.auth.updateProfile({ username: 'builder' }),
    () => client.auth.findUser('current-user'),
    () => client.databases.list(),
    () => client.databases.create({ db_name: 'app' }),
    () => client.databases.delete('app'),
    () => client.databases.getApiKey('app'),
    () => client.databases.createApiKey('app'),
    () => client.databases.deleteApiKey('app'),
  ];

  it.each(accountOperations)(
    'uses the current JWT for account and database lifecycle operations',
    async (operation) => {
      await operation();
      expect(getLastRequest(mockFetch).headers.Authorization).toBe(`Bearer ${jwt}`);
    }
  );

  it.each(accountOperations)(
    'does not substitute a database API key for a missing JWT',
    async (operation) => {
      client.setAuthToken(null);
      await expect(operation()).rejects.toThrow(AuthError);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it('applies session changes to existing modules and falls back to the API key after clearing it', async () => {
    await client.schema.listTables('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe(`Bearer ${jwt}`);
    client.setAuthToken('rotated.jwt');
    await client.records.list('app', 'items');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('Bearer rotated.jwt');
    client.setAuthToken(null);
    await client.schema.listTables('app');
    expect(getLastRequest(mockFetch).headers.Authorization).toBe('ApiKey neb_testkey');
  });

  it('supports signup, login, and profile access without an API key', async () => {
    const sessionClient = new NebulaClient({ baseURL: 'http://example.test', fetch: mockFetch });
    mockFetch.mockResolvedValueOnce(mockResponse(200, { token: jwt }));
    const login = await sessionClient.auth.login({
      email: 'builder@example.test',
      password: 'secret-password',
    });
    expect(getLastRequest(mockFetch).headers.Authorization).toBeUndefined();
    sessionClient.setAuthToken(login.token);
    await sessionClient.auth.getMe();
    expect(getLastRequest(mockFetch).headers.Authorization).toBe(`Bearer ${jwt}`);
  });
});
