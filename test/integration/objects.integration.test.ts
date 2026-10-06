import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { AuthError, BadRequestError, ForbiddenError, NotFoundError } from '../../src/errors';
import { DatabaseObjects } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Database objects against the isolated Go backend', () => {
  const database = 'sdk_objects';
  const otherDatabase = 'sdk_objects_other';
  const emptyDatabase = 'sdk_objects_empty';
  const triggerSQL =
    'CREATE TRIGGER audit_insert AFTER INSERT ON items BEGIN INSERT INTO audit (item_id, label) VALUES (NEW.id, NEW.label); END';
  let account: NebulaClient;
  let application: NebulaClient;
  let otherOwner: NebulaClient;

  async function createAccount(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`;
    const password = 'sdk-objects-password';
    await client.auth.signup({ username, email, password });
    const login = await client.auth.login({ email, password });
    client.setAuthToken(login.token);
    return client;
  }

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Objects integration tests require an isolated loopback backend.');
    }
    account = await createAccount('objects_builder');
    otherOwner = await createAccount('objects_other');
    for (const dbName of [database, otherDatabase, emptyDatabase]) {
      await account.databases.create({ db_name: dbName });
    }
    await otherOwner.databases.create({ db_name: database });
    const key = await account.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    for (const query of [
      'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, code TEXT UNIQUE)',
      'CREATE TABLE audit (item_id INTEGER, label TEXT)',
      'CREATE INDEX non_unique_label ON items(label)',
      'CREATE UNIQUE INDEX label_lookup ON items(label)',
      triggerSQL,
    ]) {
      await application.sql.execute(database, query);
    }
    await otherOwner.sql.execute(
      database,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)'
    );
    await otherOwner.sql.execute(database, 'CREATE INDEX isolated_lookup ON items(label)');
  }, 15000);

  afterAll(async () => {
    if (account?.getAuthToken()) {
      for (const dbName of [database, otherDatabase, emptyDatabase]) {
        await account.databases.delete(dbName);
      }
    }
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });

  it('returns empty collections for an empty database', async () => {
    expect(await account.objects.get(emptyDatabase)).toEqual({ indexes: [], triggers: [] });
  });

  it('inspects actual custom indexes and triggers using JWT or scoped API keys', async () => {
    const objects: DatabaseObjects = await account.objects.get(database);
    expect(await application.objects.get(database)).toEqual(objects);
    expect(objects).toEqual({
      indexes: [
        {
          name: 'label_lookup',
          tableName: 'items',
          unique: true,
          sql: 'CREATE UNIQUE INDEX label_lookup ON items(label)',
        },
        {
          name: 'non_unique_label',
          tableName: 'items',
          unique: false,
          sql: 'CREATE INDEX non_unique_label ON items(label)',
        },
      ],
      triggers: [{ name: 'audit_insert', tableName: 'items', sql: triggerSQL }],
    });
  });

  it('uses indexes, enforces uniqueness, and executes trigger actions on SQL writes', async () => {
    await application.sql.execute(database, "INSERT INTO items VALUES (1, 'first', 'code-one')");
    const audit = await application.sql.execute<[number, string]>(
      database,
      'SELECT item_id, label FROM audit'
    );
    expect(audit.rows).toEqual([[1, 'first']]);
    const plan = await application.sql.execute<[number, number, number, string]>(
      database,
      "EXPLAIN QUERY PLAN SELECT id FROM items INDEXED BY non_unique_label WHERE label = 'first'"
    );
    expect(plan.rows?.some((row) => row[3].includes('USING COVERING INDEX non_unique_label'))).toBe(
      true
    );
    await expect(
      application.sql.execute(database, "INSERT INTO items VALUES (2, 'first', 'code-two')")
    ).rejects.toBeInstanceOf(BadRequestError);
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM audit')).rows).toEqual([
      [1],
    ]);
  });

  it('isolates catalogs for owners with the same database name', async () => {
    expect(await otherOwner.objects.get(database)).toEqual({
      indexes: [
        {
          name: 'isolated_lookup',
          tableName: 'items',
          unique: false,
          sql: 'CREATE INDEX isolated_lookup ON items(label)',
        },
      ],
      triggers: [],
    });
  });

  it('preserves API-key scoping, missing resources, and rejected JWTs', async () => {
    await expect(application.objects.get(otherDatabase)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(account.objects.get('missing_database')).rejects.toBeInstanceOf(NotFoundError);
    await expect(account.objects.get('bad-name')).rejects.toBeInstanceOf(BadRequestError);
    application.setAuthToken('invalid.jwt');
    try {
      await expect(application.objects.get(database)).rejects.toBeInstanceOf(AuthError);
    } finally {
      application.setAuthToken(null);
    }
  });

  it('removes objects through SQL and stops the dropped trigger from executing', async () => {
    await application.sql.execute(database, 'DROP TRIGGER audit_insert');
    await application.sql.execute(database, 'DROP INDEX label_lookup');
    await application.sql.execute(database, 'DROP INDEX non_unique_label');
    expect(await application.objects.get(database)).toEqual({ indexes: [], triggers: [] });
    await application.sql.execute(database, "INSERT INTO items VALUES (2, 'first', 'code-two')");
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM audit')).rows).toEqual([
      [1],
    ]);
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM items')).rows).toEqual([
      [2],
    ]);
  });
});
