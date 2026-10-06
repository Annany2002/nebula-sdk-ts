import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NebulaClient } from '../../src/client';
import { AuthError, BadRequestError, ForbiddenError, NotFoundError } from '../../src/errors';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

interface RestoredDatabase {
  integrity: string;
  rows: [number, string, string, string, string][];
  objects: [string, string][];
  auditBefore: number;
  auditAfter: number;
  viewCount: number;
}

// Python's standard SQLite library verifies files independently of the SDK and HTTP server.
function inspectExport(format: 'sql' | 'sqlite', data: string | Uint8Array): RestoredDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'nebula-sdk-export-'));
  try {
    const input = join(directory, `download.${format}`);
    writeFileSync(input, data);
    return JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `
import json, sqlite3, sys
format, source, restored = sys.argv[1:]
connection = sqlite3.connect(source if format == 'sqlite' else restored)
if format == 'sql':
    with open(source, encoding='utf-8') as dump:
        connection.executescript(dump.read())
result = {'integrity': connection.execute('PRAGMA integrity_check').fetchone()[0]}
result['objects'] = connection.execute("SELECT type,name FROM sqlite_master WHERE type IN ('index','view','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
result['rows'] = connection.execute('SELECT id,hex(payload),hex(label),typeof(optional),created_at FROM items ORDER BY id').fetchall()
result['auditBefore'] = connection.execute('SELECT COUNT(*) FROM audit').fetchone()[0]
result['viewCount'] = connection.execute('SELECT COUNT(*) FROM item_view').fetchone()[0]
connection.execute("INSERT INTO items VALUES (2,X'0102','new label',NULL,'2026-10-06 12:00:00')")
result['auditAfter'] = connection.execute('SELECT COUNT(*) FROM audit').fetchone()[0]
print(json.dumps(result))
connection.close()
`,
          format,
          input,
          join(directory, 'restored.db'),
        ],
        { encoding: 'utf8' }
      )
    ) as RestoredDatabase;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

suite('Database exports against the isolated Go backend', () => {
  const database = 'sdk_exports';
  const otherDatabase = 'sdk_exports_other';
  const emptyDatabase = 'sdk_exports_empty';
  let account: NebulaClient;
  let application: NebulaClient;
  let otherOwner: NebulaClient;

  async function createAccount(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`;
    const password = 'sdk-export-password';
    await client.auth.signup({ username, email, password });
    client.setAuthToken((await client.auth.login({ email, password })).token);
    return client;
  }

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Export integration tests require an isolated loopback backend.');
    }
    account = await createAccount('export_builder');
    otherOwner = await createAccount('export_other');
    for (const dbName of [database, otherDatabase, emptyDatabase]) {
      await account.databases.create({ db_name: dbName });
    }
    await otherOwner.databases.create({ db_name: database });
    const key = await account.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    for (const owner of [account, otherOwner]) {
      for (const query of [
        'CREATE TABLE items (id INTEGER PRIMARY KEY, payload BLOB, label TEXT, optional TEXT, created_at TIMESTAMP)',
        'CREATE TABLE audit (item_id INTEGER)',
        'CREATE INDEX label_lookup ON items(label)',
        'CREATE VIEW item_view AS SELECT id FROM items',
        'CREATE TRIGGER audit_insert AFTER INSERT ON items BEGIN INSERT INTO audit VALUES (NEW.id); END',
      ])
        await owner.sql.execute(database, query);
    }
    await application.sql.execute(
      database,
      "INSERT INTO items VALUES (1,X'00FF','O''Brien Ω'||char(0)||'tail',NULL,'2026-10-06 12:00:00')"
    );
    await otherOwner.sql.execute(
      database,
      "INSERT INTO items VALUES (1,X'00FF','other owner',NULL,'2026-10-06 12:00:00')"
    );
  }, 15000);

  afterAll(async () => {
    if (account?.getAuthToken()) {
      for (const dbName of [database, otherDatabase, emptyDatabase])
        await account.databases.delete(dbName);
    }
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });

  async function restore(
    client: NebulaClient,
    format: 'sql' | 'sqlite'
  ): Promise<RestoredDatabase> {
    if (format === 'sql') {
      const result = await client.exports.sql(database);
      expect(result.filename).toBe(`${database}.sql`);
      return inspectExport(format, result.sql);
    }
    const result = await client.exports.sqlite(database);
    expect(result.filename).toBe(`${database}.db`);
    return inspectExport(format, result.data);
  }

  describe.each(['sql', 'sqlite'] as const)('%s format', (format) => {
    it('restores committed rows and dependent objects using JWT or API-key access', async () => {
      const jwt = await restore(account, format);
      expect(await restore(application, format)).toEqual(jwt);
      expect(jwt).toEqual({
        integrity: 'ok',
        rows: [
          [
            1,
            '00FF',
            Buffer.from("O'Brien Ω\0tail").toString('hex').toUpperCase(),
            'null',
            '2026-10-06 12:00:00',
          ],
        ],
        objects: [
          ['index', 'label_lookup'],
          ['trigger', 'audit_insert'],
          ['view', 'item_view'],
        ],
        auditBefore: 1,
        auditAfter: 2,
        viewCount: 1,
      });
    });

    it('isolates downloads for owners with the same database name', async () => {
      const restored = await restore(otherOwner, format);
      expect(restored.integrity).toBe('ok');
      expect(restored.rows[0][2]).toBe(Buffer.from('other owner').toString('hex').toUpperCase());
    });

    it('exports empty databases', async () => {
      if (format === 'sql') {
        const result = await account.exports.sql(emptyDatabase);
        expect(result.filename).toBe(`${emptyDatabase}.sql`);
        expect(result.sql).toContain('BEGIN TRANSACTION;');
        expect(result.sql).toContain('COMMIT;');
        expect(result.sql).not.toContain('CREATE TABLE');
      } else {
        const result = await account.exports.sqlite(emptyDatabase);
        expect(result.filename).toBe(`${emptyDatabase}.db`);
        expect(new TextDecoder().decode(result.data.slice(0, 16))).toBe('SQLite format 3\0');
        expect(result.data.length).toBeGreaterThan(16);
      }
    });

    it('enforces scoping and maps missing resources and invalid credentials', async () => {
      await expect(application.exports[format](otherDatabase)).rejects.toBeInstanceOf(
        ForbiddenError
      );
      await expect(account.exports[format]('missing_database')).rejects.toBeInstanceOf(
        NotFoundError
      );
      await expect(account.exports[format]('bad-name')).rejects.toBeInstanceOf(BadRequestError);
      application.setAuthToken('invalid.jwt');
      try {
        await expect(application.exports[format](database)).rejects.toBeInstanceOf(AuthError);
      } finally {
        application.setAuthToken(null);
      }
    });
  });
});
