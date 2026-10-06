import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { AuthError, BadRequestError, ForbiddenError, NotFoundError } from '../../src/errors';
import { DatabaseDetailsResponse } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;
suite('Database details against the isolated Go backend', () => {
  const database = 'sdk_details';
  const otherDatabase = 'sdk_details_other';
  const emptyDatabase = 'sdk_details_empty';
  let account: NebulaClient, application: NebulaClient, otherOwner: NebulaClient;
  let apiKey: string;
  async function createAccount(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`,
      password = 'sdk-details-password';
    await client.auth.signup({ username, email, password });
    client.setAuthToken((await client.auth.login({ email, password })).token);
    return client;
  }
  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('Details integration tests require an isolated loopback backend.');
    account = await createAccount('details_builder');
    otherOwner = await createAccount('details_other');
    for (const dbName of [database, otherDatabase, emptyDatabase])
      await account.databases.create({ db_name: dbName });
    await otherOwner.databases.create({ db_name: database });
    apiKey = (await account.databases.createApiKey(database)).api_key;
    application = new NebulaClient({ baseURL: baseURL!, apiKey });
    for (const query of [
      'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)',
      "INSERT INTO items(label) VALUES ('first')",
      'CREATE TABLE "quoted table" (label TEXT)',
      "INSERT INTO \"quoted table\" VALUES ('second'),('third')",
      'CREATE VIEW item_view AS SELECT * FROM items',
    ])
      await application.sql.execute(database, query);
  }, 15000);
  afterAll(async () => {
    if (account?.getAuthToken())
      for (const dbName of [database, otherDatabase, emptyDatabase])
        await account.databases.delete(dbName);
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });
  it('returns counts and metadata using JWT or scoped API keys without exposing the secret', async () => {
    const result: DatabaseDetailsResponse = await account.databases.get(database);
    expect(await application.databases.get(database)).toEqual(result);
    const detail = result.database;
    expect(detail.dbName).toBe(database);
    expect(detail.tables).toBe(2);
    expect(detail.totalRecords).toBe(3);
    expect(detail.databaseId).toBeGreaterThan(0);
    expect(detail.sizeBytes).toBeGreaterThanOrEqual(0);
    expect(typeof detail.sizeDisplay).toBe('string');
    expect(typeof detail.filePath).toBe('string');
    expect(Number.isNaN(Date.parse(detail.createdAt))).toBe(false);
    expect(detail.apiKeyPrefix).toBe((await account.databases.getApiKey(database)).key_prefix);
    expect(detail.apiKeyPrefix).not.toBe(apiKey);
    expect(detail).not.toHaveProperty('apiKey');
  });
  it('returns zero counts and omits key metadata for an empty database', async () => {
    const { database: detail } = await account.databases.get(emptyDatabase);
    expect(detail.tables).toBe(0);
    expect(detail.totalRecords).toBe(0);
    expect(detail).not.toHaveProperty('apiKeyPrefix');
  });
  it('updates record totals after writes', async () => {
    await application.sql.execute(database, "INSERT INTO items(label) VALUES ('new')");
    expect((await application.databases.get(database)).database.totalRecords).toBe(4);
  });
  it('isolates owners with the same database name', async () => {
    const own = (await account.databases.get(database)).database;
    const other = (await otherOwner.databases.get(database)).database;
    expect(other.tables).toBe(0);
    expect(other.totalRecords).toBe(0);
    expect(other.userId).not.toBe(own.userId);
    expect(other.databaseId).not.toBe(own.databaseId);
  });
  it('enforces key scoping, missing resources, and invalid database names', async () => {
    await expect(application.databases.get(otherDatabase)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(account.databases.get('missing_database')).rejects.toBeInstanceOf(NotFoundError);
    await expect(account.databases.get('bad-name')).rejects.toBeInstanceOf(BadRequestError);
  });
  it('rejects an invalid JWT instead of falling back to a valid API key', async () => {
    application.setAuthToken('invalid.jwt');
    try {
      await expect(application.databases.get(database)).rejects.toBeInstanceOf(AuthError);
    } finally {
      application.setAuthToken(null);
    }
  });
});
