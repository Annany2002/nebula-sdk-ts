import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NebulaClient } from '../../src/client';
import { AuthError, BadRequestError, ForbiddenError, NotFoundError } from '../../src/errors';
import { DatabaseAnalytics } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Analytics against the isolated Go backend', () => {
  const database = 'sdk_analytics';
  const otherDatabase = 'sdk_analytics_other';
  const emptyDatabase = 'sdk_analytics_empty';
  let account: NebulaClient;
  let application: NebulaClient;
  let otherOwner: NebulaClient;

  async function createAccount(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`;
    const password = 'sdk-analytics-password';
    await client.auth.signup({ username, email, password });
    const login = await client.auth.login({ email, password });
    client.setAuthToken(login.token);
    return client;
  }

  async function recordedSQL(
    client: NebulaClient,
    requests: number,
    total: number
  ): Promise<DatabaseAnalytics> {
    // Telemetry writes run asynchronously; bound polling below the backend's per-IP quota.
    for (let attempt = 0; attempt < 6; attempt++) {
      const report = await client.analytics.get(database);
      if (
        report.totalRequests === total &&
        report.services.find((service) => service.name === 'SQL Engine')?.requests === requests
      ) {
        return report;
      }
      await delay(200);
    }
    throw new Error(`Expected ${requests} recorded SQL requests within the polling budget.`);
  }

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Analytics integration tests require an isolated loopback backend.');
    }
    account = await createAccount('analytics_builder');
    otherOwner = await createAccount('analytics_other');
    for (const dbName of [database, otherDatabase, emptyDatabase]) {
      await account.databases.create({ db_name: dbName });
    }
    await otherOwner.databases.create({ db_name: database });
    const key = await account.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await application.sql.execute(database, 'CREATE TABLE items (label TEXT)');
    await application.sql.execute(database, 'SELECT * FROM items');
    await expect(application.sql.execute(database, 'SELECT FROM')).rejects.toBeInstanceOf(
      BadRequestError
    );
    await otherOwner.sql.execute(
      database,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)'
    );
    await otherOwner.sql.execute(database, "INSERT INTO items VALUES (1, 'other owner')");
    await otherOwner.sql.execute(database, 'SELECT * FROM items');
  }, 15000);

  afterAll(async () => {
    if (account?.getAuthToken()) {
      for (const dbName of [database, otherDatabase, emptyDatabase]) {
        await account.databases.delete(dbName);
      }
    }
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });

  it('returns a fixed window, empty history, and 100% success for an unused database', async () => {
    const report = await account.analytics.get(emptyDatabase);
    expect(report).toEqual({
      totalRequests: 0,
      successRate: 100,
      timeframe: '24h',
      advisor: [],
      services: ['SQL Engine', 'Records API', 'Tables API', 'Auth & Keys'].map((name) => ({
        name,
        requests: 0,
        warnings: 0,
        errors: 0,
        history: [],
      })),
    });
  });

  it('returns the same recorded counts with JWT and scoped API-key access', async () => {
    const report = await recordedSQL(account, 3, 4);
    expect(report).toMatchObject({ totalRequests: 4, successRate: 75, timeframe: '24h' });
    const sql = report.services.find((service) => service.name === 'SQL Engine');
    expect(sql).toMatchObject({ requests: 3, warnings: 1, errors: 0 });
    expect(sql?.history.length).toBeGreaterThan(0);
    for (const bucket of sql?.history ?? []) {
      expect(bucket.timestamp).toMatch(/^\d{2}:00$/);
      expect(bucket.errors).toBe(0);
    }
    expect(sql?.history.reduce((sum, bucket) => sum + bucket.requests, 0)).toBe(3);
    expect(sql?.history.reduce((sum, bucket) => sum + bucket.warnings, 0)).toBe(1);
    expect(report.services.find((service) => service.name === 'Auth & Keys')?.requests).toBe(1);
    expect(await application.analytics.get(database)).toEqual(report);
  });

  it('isolates telemetry and advisor findings for owners with the same database name', async () => {
    const report = await recordedSQL(otherOwner, 3, 3);
    expect(report).toMatchObject({ totalRequests: 3, successRate: 100, advisor: [] });
    expect(report.services.find((service) => service.name === 'SQL Engine')).toMatchObject({
      requests: 3,
      warnings: 0,
      errors: 0,
    });
    expect(report.services.find((service) => service.name === 'Auth & Keys')?.requests).toBe(0);
  });

  it('preserves table-specific schema advisor findings', async () => {
    const report = await application.analytics.get(database);
    expect(report.advisor).toEqual(
      expect.arrayContaining([
        {
          id: 'missing-pk-items',
          category: 'SECURITY',
          severity: 'CRITICAL',
          title: expect.any(String),
          description: expect.any(String),
          tableName: 'items',
          suggestion: expect.any(String),
        },
        {
          id: 'empty-table-items',
          category: 'SCHEMA',
          severity: 'INFO',
          title: expect.any(String),
          description: expect.any(String),
          tableName: 'items',
          suggestion: expect.any(String),
        },
      ])
    );
  });

  it('preserves database scoping, missing resources, and rejected JWTs', async () => {
    await expect(application.analytics.get(otherDatabase)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(account.analytics.get('missing_database')).rejects.toBeInstanceOf(NotFoundError);
    await expect(account.analytics.get('bad-name')).rejects.toBeInstanceOf(BadRequestError);
    application.setAuthToken('invalid.jwt');
    try {
      await expect(application.analytics.get(database)).rejects.toBeInstanceOf(AuthError);
    } finally {
      application.setAuthToken(null);
    }
  });

  it('does not count analytics reads as additional traffic', async () => {
    const first = await application.analytics.get(database);
    const second = await application.analytics.get(database);
    expect(second).toEqual(first);
    expect(second.totalRequests).toBe(4);
  });
});
