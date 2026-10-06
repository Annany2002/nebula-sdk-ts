import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { AuthError, BadRequestError, ForbiddenError, NotFoundError } from '../../src/errors';
import { SQLQueryResult } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('SQL execution against the isolated Go backend', () => {
  const database = 'sdk_sql';
  const otherDatabase = 'sdk_sql_other';
  let account: NebulaClient;
  let application: NebulaClient;

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('SQL integration tests require an isolated loopback backend.');
    }
    account = new NebulaClient({ baseURL: baseURL! });
    const email = `sql-${randomUUID()}@example.test`;
    await account.auth.signup({ username: 'sql_builder', email, password: 'sdk-sql-password' });
    const login = await account.auth.login({ email, password: 'sdk-sql-password' });
    account.setAuthToken(login.token);
    await account.databases.create({ db_name: database });
    await account.databases.create({ db_name: otherDatabase });
    const key = await account.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await account.sql.execute(
      database,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, amount REAL)'
    );
  }, 15000);

  afterAll(async () => {
    if (account?.getAuthToken()) {
      await account.databases.delete(database);
      await account.databases.delete(otherDatabase);
    }
  });

  it('returns ordered row arrays with numbers, strings, and nulls for JWT and API keys', async () => {
    const query = "SELECT 7 AS id, 'seven' AS label, NULL AS missing";
    for (const client of [account, application]) {
      const result: SQLQueryResult<[number, string, null]> = await client.sql.execute<
        [number, string, null]
      >(database, query);
      expect(result).toEqual({
        columns: ['id', 'label', 'missing'],
        rows: [[7, 'seven', null]],
        rowCount: 1,
        rowsAffected: 0,
        executionMs: expect.any(Number),
        message: expect.any(String),
      });
      expect(result.executionMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns columns but omits rows when SELECT matches nothing', async () => {
    const result = await application.sql.execute(database, 'SELECT id, label FROM items WHERE 0');
    expect(result).toMatchObject({ columns: ['id', 'label'], rowCount: 0, rowsAffected: 0 });
    expect(result).not.toHaveProperty('rows');
  });

  it('executes writes once and reports affected rows without query fields', async () => {
    const inserted = await application.sql.execute(
      database,
      "INSERT INTO items (id, label, amount) VALUES (1, 'first', 1.5)"
    );
    expect(inserted).toEqual({
      rowCount: 0,
      rowsAffected: 1,
      executionMs: expect.any(Number),
      message: expect.any(String),
    });
    const updated = await application.sql.execute(
      database,
      "UPDATE items SET label = 'updated' WHERE id = 1"
    );
    expect(updated.rowsAffected).toBe(1);
    const selected = await account.sql.execute<[number, string, number]>(
      database,
      'SELECT id, label, amount FROM items'
    );
    expect(selected.rows).toEqual([[1, 'updated', 1.5]]);
    const deleted = await account.sql.execute(database, 'DELETE FROM items WHERE id = 1');
    expect(deleted.rowsAffected).toBe(1);
  });

  it('supports query paths for CTEs, PRAGMA, and EXPLAIN', async () => {
    const cte = await application.sql.execute(
      database,
      'WITH source(value) AS (SELECT 3) SELECT value FROM source'
    );
    expect(cte.rows).toEqual([[3]]);
    const pragma = await application.sql.execute(database, 'PRAGMA table_info(items)');
    expect(pragma.columns).toEqual(['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk']);
    expect(pragma.rowCount).toBe(3);
    const explained = await application.sql.execute(
      database,
      'EXPLAIN QUERY PLAN SELECT * FROM items'
    );
    expect(explained.rowCount).toBeGreaterThan(0);
  });

  it('preserves database scoping and authentication failures', async () => {
    await expect(application.sql.execute(otherDatabase, 'SELECT 1')).rejects.toBeInstanceOf(
      ForbiddenError
    );
    await expect(account.sql.execute('missing_database', 'SELECT 1')).rejects.toBeInstanceOf(
      NotFoundError
    );
    application.setAuthToken('invalid.jwt');
    try {
      await expect(application.sql.execute(database, 'SELECT 1')).rejects.toBeInstanceOf(AuthError);
    } finally {
      application.setAuthToken(null);
    }
  });

  it.each(['SELECT FROM', "ATTACH DATABASE ':memory:' AS outside"])(
    'maps invalid or prohibited SQL to BadRequestError: %s',
    async (query) => {
      await expect(application.sql.execute(database, query)).rejects.toBeInstanceOf(
        BadRequestError
      );
    }
  );
});
