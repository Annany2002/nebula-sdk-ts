import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { AuthError, ConflictError, ForbiddenError } from '../../src/errors';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Authentication against the local Go backend', () => {
  const database = 'sdk_auth';
  let account: NebulaClient;
  let application: NebulaClient;
  let userId: string;
  let token: string;
  let apiKey: string;
  const requests: RequestInit[] = [];

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Integration tests require an isolated loopback backend.');
    }
    account = new NebulaClient({
      baseURL: baseURL!,
      fetch: (input, init) => {
        requests.push(init ?? {});
        return fetch(input, init);
      },
    });
    const email = `sdk-${randomUUID()}@example.test`;
    await account.auth.signup({ username: 'sdk_builder', email, password: 'sdk-test-password' });
    const login = await account.auth.login({ email, password: 'sdk-test-password' });
    token = login.token;
    userId = login.user.userId;
    account.setAuthToken(token);
    await account.databases.create({ db_name: database });
    await account.databases.create({ db_name: 'sdk_other' });
    const key = await account.databases.createApiKey(database);
    apiKey = key.api_key;
    application = new NebulaClient({ baseURL: baseURL!, apiKey });
    await application.schema.define(database, {
      table_name: 'items',
      columns: [{ name: 'label', type: 'TEXT' }],
    });
  }, 15000);

  it('signs up and logs in without sending existing credentials', () => {
    expect(
      requests.slice(0, 2).map((request) => new Headers(request.headers).get('Authorization'))
    ).toEqual([null, null]);
    expect(token).toBeTruthy();
  });

  it('uses the JWT for profile and account access', async () => {
    await expect(account.auth.getMe()).resolves.toMatchObject({ userId, username: 'sdk_builder' });
    await expect(account.auth.updateProfile({ username: 'sdk_updated' })).resolves.toMatchObject({
      user: { userId, username: 'sdk_updated' },
    });
    await expect(account.auth.findUser(userId)).resolves.toMatchObject({ userId });
    await expect(account.databases.list()).resolves.toMatchObject({
      databases: expect.arrayContaining([expect.objectContaining({ dbName: database })]),
    });
  });

  it('uses the API key for schema access and record CRUD', async () => {
    await expect(application.schema.listTables(database)).resolves.toMatchObject({
      tables: expect.arrayContaining([expect.objectContaining({ name: 'items' })]),
    });
    await application.records.create(database, 'items', { label: 'from-sdk' });
    await expect(application.records.get(database, 'items', 1)).resolves.toMatchObject({
      id: 1,
      label: 'from-sdk',
    });
    await application.records.update(database, 'items', 1, { label: 'updated' });
    await expect(application.records.list(database, 'items')).resolves.toMatchObject({
      records: [{ id: 1, label: 'updated', created_at: expect.any(String) }],
      pagination: { total: 1 },
    });
    await expect(application.records.delete(database, 'items', 1)).resolves.toBeUndefined();
  });

  it('preserves database scoping and maps server denials', async () => {
    await expect(application.schema.listTables('sdk_other')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(application.auth.getMe()).rejects.toBeInstanceOf(AuthError);
    await expect(application.databases.delete(database)).rejects.toBeInstanceOf(AuthError);
  });

  it('supports JWT key metadata, rotation, and revocation', async () => {
    await expect(account.databases.getApiKey(database)).resolves.toMatchObject({
      key_prefix: expect.any(String),
      created_at: expect.any(String),
    });
    const rotated = await account.databases.createApiKey(database);
    expect(rotated.api_key).not.toBe(apiKey);
    await expect(application.schema.listTables(database)).rejects.toBeInstanceOf(AuthError);
    const rotatedClient = new NebulaClient({ baseURL: baseURL!, apiKey: rotated.api_key });
    await expect(rotatedClient.schema.listTables(database)).resolves.toHaveProperty('tables');
    await account.databases.deleteApiKey(database);
    await expect(rotatedClient.schema.listTables(database)).rejects.toBeInstanceOf(AuthError);
  });

  it('maps backend duplicate-resource responses to ConflictError', async () => {
    await expect(account.databases.create({ db_name: database })).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
    });
    await expect(account.databases.create({ db_name: database })).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  it('uses headers accepted by the backend browser preflight policy', async () => {
    const headerNames: string[] = [];
    new Headers(requests[requests.length - 1].headers).forEach((_value, name) => {
      if (name !== 'accept') headerNames.push(name);
    });
    const preflight = await fetch(`${baseURL}/api/v1/account/user/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': headerNames.join(','),
      },
    });
    expect(preflight.status).toBe(204);
    const allowed = preflight.headers
      .get('access-control-allow-headers')
      ?.toLowerCase()
      .split(',')
      .map((value) => value.trim());
    for (const header of headerNames) expect(allowed).toContain(header);
  });

  it('does not silently fall back to an API key when a JWT is rejected', async () => {
    const key = await account.databases.createApiKey(database);
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>((input, init) =>
      fetch(input, init)
    );
    const client = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key, fetch: request });
    await expect(client.schema.listTables(database)).resolves.toHaveProperty('tables');
    request.mockClear();
    client.setAuthToken('invalid.jwt.token');
    await expect(client.schema.listTables(database)).rejects.toBeInstanceOf(AuthError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.getAuthToken()).toBe('invalid.jwt.token');
  });

  it('deletes the database using the account JWT', async () => {
    await expect(account.databases.delete(database)).resolves.toBeUndefined();
    await account.databases.delete('sdk_other');
    await expect(account.databases.list()).resolves.toMatchObject({ databases: [] });
  });
});
