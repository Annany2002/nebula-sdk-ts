import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../src/errors';
import { CreateIndexResponse, DropIndexResponse } from '../../src/types';
const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Native index management against the isolated Go backend', () => {
  const database = 'sdk_indexes';
  let owner: NebulaClient;
  let application: NebulaClient;
  let otherOwner: NebulaClient;
  async function account(username: string) {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`,
      password = 'sdk-index-test-password';
    await client.auth.signup({ username, email, password });
    const login = await client.auth.login({ email, password });
    client.setAuthToken(login.token);
    return client;
  }
  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('Index tests require an isolated loopback backend.');
    owner = await account('index_builder');
    otherOwner = await account('index_other');
    await owner.databases.create({ db_name: database });
    await owner.databases.create({ db_name: 'sdk_indexes_other' });
    await otherOwner.databases.create({ db_name: database });
    const key = await owner.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await application.sql.execute(
      database,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, region TEXT, code TEXT UNIQUE)'
    );
    await application.sql.execute(
      database,
      "INSERT INTO items VALUES (1, 'same', 'EU', 'one'), (2, 'same', 'US', 'two')"
    );
    await application.sql.execute(
      database,
      'CREATE TABLE "odd table" ("display name" TEXT, "quoted""column" INTEGER)'
    );
    await otherOwner.sql.execute(
      database,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, region TEXT)'
    );
  }, 15000);
  afterAll(async () => {
    if (owner?.getAuthToken()) {
      await owner.databases.delete(database);
      await owner.databases.delete('sdk_indexes_other');
    }
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });
  it('creates a composite index with canonical table and column metadata, then uses it', async () => {
    const response: CreateIndexResponse = await owner.objects.createIndex(database, {
      name: 'idx_region_label',
      table_name: 'ITEMS',
      columns: ['REGION', 'label'],
    });
    expect(response).toEqual({
      message: 'Index created successfully',
      db_name: database,
      index: {
        name: 'idx_region_label',
        tableName: 'items',
        unique: false,
        sql: 'CREATE INDEX "idx_region_label" ON "items" ("region", "label")',
      },
    });
    const plan = await application.sql.execute<[number, number, number, string]>(
      database,
      "EXPLAIN QUERY PLAN SELECT label FROM items WHERE region='EU'"
    );
    expect(plan.rows?.some((row) => row[3].includes('idx_region_label'))).toBe(true);
    expect((await application.objects.get(database)).indexes).toContainEqual(response.index);
  });
  it('maps duplicate names and existing duplicate data to conflicts without changing records', async () => {
    await expect(
      application.objects.createIndex(database, {
        name: 'IDX_REGION_LABEL',
        table_name: 'items',
        columns: ['label'],
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      application.objects.createIndex(database, {
        name: 'idx_duplicate_labels',
        table_name: 'items',
        columns: ['label'],
        unique: true,
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      (await application.objects.get(database)).indexes.map((index) => index.name)
    ).not.toContain('idx_duplicate_labels');
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM items')).rows).toEqual([
      [2],
    ]);
  });
  it('supports quoted columns and API-key unique-index creation and deletion', async () => {
    const response = await application.objects.createIndex(database, {
      name: 'sqliteX_display',
      table_name: 'odd table',
      columns: ['display name', 'quoted"column'],
      unique: true,
    });
    expect(response.index.sql).toBe(
      'CREATE UNIQUE INDEX "sqliteX_display" ON "odd table" ("display name", "quoted""column")'
    );
    expect((await application.objects.get(database)).indexes).toContainEqual(response.index);
    const dropped: DropIndexResponse = await application.objects.dropIndex(
      database,
      'SQLITEX_DISPLAY'
    );
    expect(dropped.index_name).toBe('sqliteX_display');
    expect(dropped.db_name).toBe(database);
  });
  it('enforces unique indexes and removes only their constraint when dropped', async () => {
    await application.objects.createIndex(database, {
      name: 'idx_unique_regions',
      table_name: 'items',
      columns: ['region'],
      unique: true,
    });
    await expect(
      application.records.create(database, 'items', { label: 'third', region: 'EU', code: 'three' })
    ).rejects.toBeInstanceOf(ConflictError);
    await owner.objects.dropIndex(database, 'idx_unique_regions');
    await application.records.create(database, 'items', {
      label: 'third',
      region: 'EU',
      code: 'three',
    });
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM items')).rows).toEqual([
      [3],
    ]);
  });
  it('protects automatic indexes and rejects invalid or missing schema targets', async () => {
    await expect(
      owner.objects.dropIndex(database, 'sqlite_autoindex_items_1')
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      owner.objects.createIndex(database, {
        name: 'sqlite_forbidden',
        table_name: 'items',
        columns: ['label'],
      })
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      owner.objects.createIndex(database, {
        name: 'idx_missing_column',
        table_name: 'items',
        columns: ['unknown'],
      })
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      owner.objects.createIndex(database, {
        name: 'idx_missing_table',
        table_name: 'unknown',
        columns: ['label'],
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(owner.objects.dropIndex(database, 'missing_index')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
  it('preserves owner isolation, API-key database scope, and rejected sessions', async () => {
    await otherOwner.objects.createIndex(database, {
      name: 'idx_region_label',
      table_name: 'items',
      columns: ['label'],
    });
    await otherOwner.objects.dropIndex(database, 'idx_region_label');
    expect((await owner.objects.get(database)).indexes.map((index) => index.name)).toContain(
      'idx_region_label'
    );
    await expect(
      application.objects.createIndex('sdk_indexes_other', {
        name: 'idx_label',
        table_name: 'items',
        columns: ['label'],
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      application.objects.dropIndex('sdk_indexes_other', 'idx_region_label')
    ).rejects.toBeInstanceOf(ForbiddenError);
    application.setAuthToken('invalid.jwt');
    try {
      await expect(
        application.objects.dropIndex(database, 'idx_region_label')
      ).rejects.toBeInstanceOf(AuthError);
    } finally {
      application.setAuthToken(null);
    }
  });
  it('drops custom indexes without deleting records and reports repeated deletion as missing', async () => {
    expect((await application.objects.dropIndex(database, 'idx_region_label')).index_name).toBe(
      'idx_region_label'
    );
    await expect(
      application.objects.dropIndex(database, 'idx_region_label')
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM items')).rows).toEqual([
      [3],
    ]);
  });
});
