import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { BadRequestError, NotFoundError } from '../../src/errors';
import { RecordListResponse, RecordMutationResponse, SchemaPayload } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Existing SDK contracts against the local Go backend', () => {
  const database = 'sdk_contracts';
  let account: NebulaClient;
  let data: NebulaClient;
  let userId: string;
  let token: string;
  let prefix: string;

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Contract tests require an isolated loopback backend.');
    }
    account = new NebulaClient({ baseURL: baseURL! });
    const email = `contract-${randomUUID()}@example.test`;
    const signup = await account.auth.signup({
      username: 'sdk_contracts',
      email,
      password: 'sdk-contract-password',
    });
    expect(signup).toEqual({
      message: 'User registered successfully',
      user_id: expect.any(String),
    });
    userId = signup.user_id;
    const login = await account.auth.login({ email, password: 'sdk-contract-password' });
    expect(login.user).toEqual({
      userId,
      username: 'sdk_contracts',
      email,
      createdAt: expect.any(String),
    });
    token = login.token;
    account.setAuthToken(token);
    const created = await account.databases.create({ db_name: database });
    expect(created).toEqual({ db_name: database, message: 'Database registered successfully' });
    const key = await account.databases.createApiKey(database);
    expect(key.api_key).toEqual(expect.any(String));
    const metadata = await account.databases.getApiKey(database);
    expect(metadata).toEqual({ key_prefix: expect.any(String), created_at: expect.any(String) });
    prefix = metadata.key_prefix;
    data = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
  }, 15000);

  afterAll(async () => {
    if (account?.getAuthToken()) await account.databases.delete(database);
  });

  it('returns safe user profiles and both protected health response shapes', async () => {
    const me = await account.auth.getMe();
    expect(me.userId).toBe(userId);
    expect(me).not.toHaveProperty('password');
    expect(me).not.toHaveProperty('PasswordHash');
    expect(await account.auth.findUser(userId)).toEqual(me);
    expect(await account.auth.healthP()).toEqual({ userId, dbId: null });
    expect(await data.auth.healthP()).toEqual({ authenticated_by: 'api_key', status: 'ok' });
  });

  it('lists database metadata without requiring or exposing a full API key', async () => {
    const listed = await account.databases.list();
    expect(listed.databases).toEqual([
      {
        databaseId: expect.any(Number),
        userId,
        dbName: database,
        filePath: expect.any(String),
        createdAt: expect.any(String),
        tables: 0,
        apiKeyPrefix: prefix,
      },
    ]);
    expect(listed.databases[0]).not.toHaveProperty('apiKey');
  });

  it('acknowledges table creation through both endpoints and supports the schema alias', async () => {
    const payload: SchemaPayload = {
      table_name: 'items',
      schema: [
        { name: 'label', type: 'TEXT' },
        { name: 'price', type: 'NUMERIC' },
      ],
    };
    expect(await data.schema.define(database, payload)).toEqual({
      message: "Table 'items' created or already exists.",
      db_name: database,
      table_name: 'items',
    });
    const repeated = await data.schema.createTable(database, {
      table_name: 'items',
      columns: [{ name: 'ignored', type: 'TEXT' }],
    });
    expect(repeated.table_name).toBe('items');
    const schema = await data.schema.getSchema(database, 'items');
    expect(schema).toEqual({
      schema: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'label', type: 'TEXT', pk: false },
        { name: 'price', type: 'NUMERIC', pk: false },
        { name: 'created_at', type: 'TIMESTAMP', pk: false },
      ],
    });
    await expect(data.schema.getSchema(database, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('preserves foreign-key definitions at both column and table level', async () => {
    await data.schema.createTable(database, {
      table_name: 'links',
      columns: [
        {
          name: 'item_id',
          type: 'INTEGER',
          foreign_key: {
            target_table: 'items',
            target_column: 'id',
            on_delete: 'CASCADE',
            on_update: 'RESTRICT',
          },
        },
        { name: 'other_id', type: 'INTEGER' },
      ],
      foreign_keys: [
        {
          column: 'other_id',
          target_table: 'items',
          target_column: 'id',
          on_delete: 'SET NULL',
          on_update: 'NO ACTION',
        },
      ],
    });
    const tables = await data.schema.listTables(database);
    const links = tables.tables.find((table) => table.name === 'links')!;
    expect(links.rowCount).toBe(0);
    expect(links.sql).toContain(
      'FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE ON UPDATE RESTRICT'
    );
    expect(links.sql).toContain(
      'FOREIGN KEY (other_id) REFERENCES items(id) ON DELETE SET NULL ON UPDATE NO ACTION'
    );
    expect(links.columns[0]).toEqual({
      cid: '0',
      name: 'id',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 1,
    });
    expect(links.columns.find((column) => column.name === 'created_at')?.dflt_value).toBe(
      'CURRENT_TIMESTAMP'
    );
    await expect(
      data.schema.createTable(database, {
        table_name: 'invalid',
        columns: [{ name: 'label', type: 'INVALID' }],
      })
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('returns mutation acknowledgements and paginated, filtered, selected rows', async () => {
    const created: RecordMutationResponse = await data.records.create(database, 'items', {
      label: 'first',
      price: 10,
    });
    expect(created).toEqual({ message: 'Record created successfully', record_id: 1 });
    await data.records.create(database, 'items', { label: 'second', price: 20 });
    const page: RecordListResponse<{ label: string; price: number }> = await data.records.list(
      database,
      'items',
      undefined,
      { limit: 1, offset: 1, sort: 'price', order: 'desc', fields: 'label,price' }
    );
    expect(page).toEqual({
      records: [{ label: 'first', price: 10 }],
      pagination: { total: 2, limit: 1, offset: 1 },
    });
    expect(await data.records.list(database, 'items', { label: 'second' })).toMatchObject({
      records: [{ id: 2, label: 'second' }],
      pagination: { total: 1, limit: 100, offset: 0 },
    });
    expect(
      await data.records.update(database, 'items', created.record_id, { label: 'updated' })
    ).toEqual({ message: 'Record updated successfully', record_id: 1 });
    const row = await data.records.get<{ id: number; label: string }>(
      database,
      'items',
      created.record_id
    );
    expect(row.label).toBe('updated');
    await data.records.delete(database, 'items', created.record_id);
    await data.records.delete(database, 'items', 2);
    expect(await data.records.list(database, 'items')).toEqual({
      records: [],
      pagination: { total: 0, limit: 100, offset: 0 },
    });
  });

  it.each([
    ['text_key', 'item_key TEXT PRIMARY KEY', 'key one?#'],
    ['renamed_key', 'item_key INTEGER PRIMARY KEY', -7],
  ])('uses the actual primary key of %s for record CRUD', async (tableName, definition, id) => {
    // Raw SQL creates fixtures with custom primary keys.
    const setup = await fetch(`${baseURL}/api/v1/databases/${database}/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `CREATE TABLE ${tableName} (${definition}, label TEXT)` }),
    });
    expect(setup.status).toBe(200);
    await setup.json();
    const created = await data.records.create(database, tableName, {
      item_key: id,
      label: 'created',
    });
    expect(created.record_id).toBe(id);
    const row = await data.records.get<{ item_key: string | number; label: string }>(
      database,
      tableName,
      id
    );
    expect(row).toEqual({ item_key: id, label: 'created' });
    const updated = await data.records.update(database, tableName, id, { label: 'updated' });
    expect(updated.record_id).toBe(id);
    await data.records.delete(database, tableName, id);
    await expect(data.records.get(database, tableName, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
