import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ServerError,
} from '../../src/errors';
import { AlterTableOperation, AlterTableResponse } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;
suite('Schema alterations against the isolated Go backend', () => {
  const database = 'sdk_alter';
  const otherDatabase = 'sdk_alter_other';
  let account: NebulaClient, application: NebulaClient, otherOwner: NebulaClient;
  let createdAt: string;
  async function createAccount(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`,
      password = 'sdk-alter-password';
    await client.auth.signup({ username, email, password });
    client.setAuthToken((await client.auth.login({ email, password })).token);
    return client;
  }
  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('Alteration tests require an isolated loopback backend.');
    account = await createAccount('alter_builder');
    otherOwner = await createAccount('alter_other');
    for (const dbName of [database, otherDatabase])
      await account.databases.create({ db_name: dbName });
    await otherOwner.databases.create({ db_name: database });
    application = new NebulaClient({
      baseURL: baseURL!,
      apiKey: (await account.databases.createApiKey(database)).api_key,
    });
    for (const owner of [application, otherOwner]) {
      await owner.schema.createTable(database, {
        table_name: 'items',
        columns: [
          { name: 'label', type: 'TEXT' },
          { name: 'obsolete', type: 'TEXT' },
        ],
      });
      await owner.sql.execute(database, "INSERT INTO items(label) VALUES ('first')");
    }
    await application.schema.createTable(database, {
      table_name: 'parents',
      columns: [{ name: 'label', type: 'TEXT' }],
    });
    await application.sql.execute(database, "INSERT INTO parents(label) VALUES ('parent')");
    createdAt = (await application.schema.listTables(database)).tables.find(
      (table) => table.name === 'items'
    )!.createdAt;
  }, 15000);
  afterAll(async () => {
    if (account?.getAuthToken())
      for (const dbName of [database, otherDatabase]) await account.databases.delete(dbName);
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });
  it('adds a required column with a SQL default to existing rows using a scoped key', async () => {
    const result: AlterTableResponse = await application.schema.alterTable(database, 'items', {
      action: 'add_column',
      column: { name: 'stock', type: 'INTEGER', not_null: true, default_value: '0' },
    });
    expect(result).toMatchObject({
      db_name: database,
      table_name: 'items',
      statements: [expect.stringContaining('NOT NULL DEFAULT 0')],
    });
    expect(result.schema).toEqual(expect.any(Array));
    expect(
      (await application.sql.execute<[number]>(database, 'SELECT stock FROM items')).rows
    ).toEqual([[0]]);
  });
  it('renames a column with a JWT while preserving its values', async () => {
    const result = await account.schema.alterTable(database, 'items', {
      action: 'rename_column',
      old_name: 'stock',
      new_name: 'inventory',
    });
    expect(result.statements).toHaveLength(1);
    expect(
      (await application.sql.execute<[number]>(database, 'SELECT inventory FROM items')).rows
    ).toEqual([[0]]);
  });
  it('adds a nullable foreign key and enforces its delete action', async () => {
    await application.schema.alterTable(database, 'items', {
      action: 'add_column',
      column: {
        name: 'parent_id',
        type: 'INTEGER',
        default_value: null,
        foreign_key: { target_table: 'parents', target_column: 'id', on_delete: 'SET NULL' },
      },
    });
    await application.sql.execute(database, 'UPDATE items SET parent_id = 1');
    await application.sql.execute(database, 'DELETE FROM parents WHERE id = 1');
    expect(
      (await application.sql.execute<[number | null]>(database, 'SELECT parent_id FROM items')).rows
    ).toEqual([[null]]);
  });
  it('drops only the requested column', async () => {
    await application.schema.alterTable(database, 'items', {
      action: 'drop_column',
      column_name: 'obsolete',
    });
    const table = (await application.schema.listTables(database)).tables.find(
      (table) => table.name === 'items'
    )!;
    expect(table.columns.map((column) => column.name)).not.toContain('obsolete');
    expect(table.rowCount).toBe(1);
  });
  it('applies an ordered batch after a table rename and preserves creation metadata', async () => {
    const result = await application.schema.alterTable(database, 'items', {
      operations: [
        { action: 'rename_table', new_table_name: 'inventory_items' },
        { action: 'add_column', column: { name: 'notes', type: 'TEXT', default_value: "'draft'" } },
        { action: 'rename_column', old_name: 'notes', new_name: 'remarks' },
      ],
    });
    expect(result.table_name).toBe('inventory_items');
    expect(result.statements).toHaveLength(3);
    expect(
      (
        await application.sql.execute<[number, string]>(
          database,
          'SELECT inventory, remarks FROM inventory_items'
        )
      ).rows
    ).toEqual([[0, 'draft']]);
    const tables = (await application.schema.listTables(database)).tables;
    expect(tables.map((table) => table.name)).not.toContain('items');
    expect(tables.find((table) => table.name === 'inventory_items')!.createdAt).toBe(createdAt);
  });
  it('rolls back earlier operations when a later SQLite statement fails', async () => {
    await expect(
      application.schema.alterTable(database, 'inventory_items', {
        operations: [
          { action: 'add_column', column: { name: 'transient', type: 'TEXT' } },
          { action: 'drop_column', column_name: 'missing_column' },
        ],
      })
    ).rejects.toBeInstanceOf(ServerError);
    const table = (await application.schema.listTables(database)).tables.find(
      (table) => table.name === 'inventory_items'
    )!;
    expect(table.columns.map((column) => column.name)).not.toContain('transient');
    expect(table.rowCount).toBe(1);
  });
  it('preserves backend validation errors', async () => {
    const invalid: AlterTableOperation[] = [
      { action: 'drop_column', column_name: 'id' },
      { action: 'add_column', column: { name: 'bad_type', type: 'INVALID' } },
      { action: 'add_column', column: { name: 'required', type: 'TEXT', not_null: true } },
    ];
    for (const operation of invalid)
      await expect(
        application.schema.alterTable(database, 'inventory_items', operation)
      ).rejects.toBeInstanceOf(BadRequestError);
  });
  it('isolates the other owner with the same database and table names', async () => {
    const tables = (await otherOwner.schema.listTables(database)).tables;
    expect(tables.map((table) => table.name)).toEqual(['items']);
    expect(tables[0].columns.map((column) => column.name)).toEqual([
      'id',
      'label',
      'obsolete',
      'created_at',
    ]);
    expect(tables[0].rowCount).toBe(1);
  });
  it('enforces database scoping and rejects invalid JWTs without fallback', async () => {
    const operation: AlterTableOperation = { action: 'rename_table', new_table_name: 'renamed' };
    await expect(
      application.schema.alterTable(otherDatabase, 'items', operation)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      account.schema.alterTable('missing_database', 'items', operation)
    ).rejects.toBeInstanceOf(NotFoundError);
    application.setAuthToken('invalid.jwt');
    try {
      await expect(
        application.schema.alterTable(database, 'inventory_items', operation)
      ).rejects.toBeInstanceOf(AuthError);
    } finally {
      application.setAuthToken(null);
    }
  });
});
