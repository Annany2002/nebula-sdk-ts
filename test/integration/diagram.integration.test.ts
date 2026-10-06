import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { AuthError, BadRequestError, ForbiddenError, NotFoundError } from '../../src/errors';
import { SchemaDiagram } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Schema diagrams against the isolated Go backend', () => {
  const database = 'sdk_diagrams';
  const otherDatabase = 'sdk_diagrams_other';
  const emptyDatabase = 'sdk_diagrams_empty';
  let account: NebulaClient;
  let application: NebulaClient;
  let otherOwner: NebulaClient;

  async function createAccount(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`;
    const password = 'sdk-diagram-password';
    await client.auth.signup({ username, email, password });
    const login = await client.auth.login({ email, password });
    client.setAuthToken(login.token);
    return client;
  }

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Diagram integration tests require an isolated loopback backend.');
    }
    account = await createAccount('diagram_builder');
    otherOwner = await createAccount('diagram_other');
    for (const dbName of [database, otherDatabase, emptyDatabase]) {
      await account.databases.create({ db_name: dbName });
    }
    await otherOwner.databases.create({ db_name: database });
    const key = await account.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    for (const query of [
      "CREATE TABLE parents (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL DEFAULT 'untitled')",
      'CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER, FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE ON UPDATE RESTRICT)',
      'CREATE TABLE composite_parents (a TEXT, b INTEGER, PRIMARY KEY (a, b))',
      'CREATE TABLE composite_children (x TEXT, y INTEGER, FOREIGN KEY (x, y) REFERENCES composite_parents(a, b) ON UPDATE CASCADE ON DELETE SET NULL)',
      'CREATE VIEW parent_labels AS SELECT label FROM parents',
      "INSERT INTO parents (label) VALUES ('first'), ('second')",
      'INSERT INTO children (id, parent_id) VALUES (1, 1)',
    ]) {
      await application.sql.execute(database, query);
    }
    // listTables creates Nebula's metadata table, which the diagram must exclude.
    await application.schema.listTables(database);
    await otherOwner.sql.execute(database, 'CREATE TABLE isolated_items (id INTEGER PRIMARY KEY)');
  }, 15000);

  afterAll(async () => {
    if (account?.getAuthToken()) {
      for (const dbName of [database, otherDatabase, emptyDatabase]) {
        await account.databases.delete(dbName);
      }
    }
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });

  it('returns empty arrays and zero totals for an empty database', async () => {
    expect(await account.diagrams.get(emptyDatabase)).toEqual({
      tables: [],
      totalTables: 0,
      totalForeignKeys: 0,
    });
  });

  it('returns the same sorted tables and row counts with JWT and API-key access', async () => {
    const diagram: SchemaDiagram = await account.diagrams.get(database);
    expect(await application.diagrams.get(database)).toEqual(diagram);
    expect(diagram.totalTables).toBe(4);
    expect(diagram.tables.map((table) => table.name)).toEqual([
      'children',
      'composite_children',
      'composite_parents',
      'parents',
    ]);
    expect(diagram.tables.map((table) => table.rowCount)).toEqual([1, 0, 0, 2]);
    for (const table of diagram.tables) {
      expect(table.sql).toContain(`CREATE TABLE ${table.name}`);
    }
    expect(diagram.tables.find((table) => table.name === 'parents')?.foreignKeys).toEqual([]);
  });

  it('preserves string column IDs, numeric flags, and SQL default expressions', async () => {
    const diagram = await application.diagrams.get(database);
    const parents = diagram.tables.find((table) => table.name === 'parents');
    expect(parents?.columns).toEqual([
      { cid: '0', name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
      { cid: '1', name: 'label', type: 'TEXT', notnull: 1, dflt_value: "'untitled'", pk: 0 },
    ]);
    const composite = diagram.tables.find((table) => table.name === 'composite_parents');
    expect(composite?.columns.map((column) => column.pk)).toEqual([1, 2]);
  });

  it('preserves single and composite foreign-key column pairs and actions', async () => {
    const diagram = await application.diagrams.get(database);
    expect(diagram.totalForeignKeys).toBe(3);
    expect(diagram.tables.find((table) => table.name === 'children')?.foreignKeys).toEqual([
      {
        id: 0,
        seq: 0,
        table: 'parents',
        from: 'parent_id',
        to: 'id',
        onUpdate: 'RESTRICT',
        onDelete: 'CASCADE',
      },
    ]);
    expect(
      diagram.tables.find((table) => table.name === 'composite_children')?.foreignKeys
    ).toEqual([
      {
        id: 0,
        seq: 0,
        table: 'composite_parents',
        from: 'x',
        to: 'a',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      {
        id: 0,
        seq: 1,
        table: 'composite_parents',
        from: 'y',
        to: 'b',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    ]);
  });

  it('isolates schema metadata for owners with the same database name', async () => {
    const diagram = await otherOwner.diagrams.get(database);
    expect(diagram).toMatchObject({ totalTables: 1, totalForeignKeys: 0 });
    expect(diagram.tables.map((table) => table.name)).toEqual(['isolated_items']);
    expect(diagram.tables[0].rowCount).toBe(0);
  });

  it('preserves database scoping, missing resources, and rejected JWTs', async () => {
    await expect(application.diagrams.get(otherDatabase)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(account.diagrams.get('missing_database')).rejects.toBeInstanceOf(NotFoundError);
    await expect(account.diagrams.get('bad-name')).rejects.toBeInstanceOf(BadRequestError);
    application.setAuthToken('invalid.jwt');
    try {
      await expect(application.diagrams.get(database)).rejects.toBeInstanceOf(AuthError);
    } finally {
      application.setAuthToken(null);
    }
  });
});
