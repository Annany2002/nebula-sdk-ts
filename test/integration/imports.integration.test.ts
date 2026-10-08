import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NebulaClient } from '../../src/client';
import { AuthError, BadRequestError, ConflictError, NotFoundError } from '../../src/errors';
import { SQLiteImportResponse } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('SQLite import against the isolated Go backend', () => {
  const database = 'sdk_imported';
  const copyDatabase = 'sdk_imported_copy';
  let directory: string;
  let snapshot: Buffer;
  let foreignKeyViolation: Buffer;
  let account: NebulaClient;
  let otherOwner: NebulaClient;
  let imported: SQLiteImportResponse;
  const created: string[] = [];
  let otherCreated = false;

  async function createAccount(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL!, timeout: 75_000 });
    const email = `${username}-${randomUUID()}@example.test`;
    const password = 'sdk-import-password';
    await client.auth.signup({ username, email, password });
    client.setAuthToken((await client.auth.login({ email, password })).token);
    return client;
  }

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Import integration tests require an isolated loopback backend.');
    }
    directory = mkdtempSync(join(tmpdir(), 'nebula-sdk-import-'));
    // The backup includes committed WAL data. Leave an AUTOINCREMENT gap and
    // include values that JSON row conversion alone cannot faithfully restore.
    execFileSync('python3', [
      '-c',
      `
import sqlite3, sys
from pathlib import Path
root = Path(sys.argv[1])
source = sqlite3.connect(root / 'active.db')
source.executescript("""
PRAGMA journal_mode=WAL;
CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT UNIQUE, payload BLOB, optional TEXT);
CREATE TABLE related(item_id INTEGER REFERENCES items(id));
CREATE TABLE audit(item_id INTEGER);
CREATE INDEX related_lookup ON related(item_id);
CREATE VIEW item_view AS SELECT id,label FROM items;
CREATE TRIGGER audit_insert AFTER INSERT ON items BEGIN INSERT INTO audit VALUES(NEW.id); END;
INSERT INTO items(label,payload,optional) VALUES('O''Brien Ω'||char(0)||'tail',X'00FF',NULL);
INSERT INTO items(label,payload,optional) VALUES('committed-in-wal',X'0102',NULL);
INSERT INTO items(id,label) VALUES(10,'sequence gap');
DELETE FROM items WHERE id=10;
INSERT INTO related VALUES(1);
""")
source.commit()
snapshot = sqlite3.connect(root / 'snapshot.db')
source.backup(snapshot)
snapshot.close()
source.execute('UPDATE related SET item_id=999')
source.commit()
invalid = sqlite3.connect(root / 'foreign-key-violation.db')
source.backup(invalid)
invalid.close()
source.close()
`,
      directory,
    ]);
    snapshot = readFileSync(join(directory, 'snapshot.db'));
    foreignKeyViolation = readFileSync(join(directory, 'foreign-key-violation.db'));
    account = await createAccount('import_builder');
    otherOwner = await createAccount('import_other');
    imported = await account.databases.importSQLite({ db_name: database, file: snapshot });
    created.push(database);
  }, 20_000);

  afterAll(async () => {
    try {
      if (account?.getAuthToken()) {
        for (const dbName of created) await account.databases.delete(dbName);
      }
      if (otherCreated) await otherOwner.databases.delete(database);
    } finally {
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  });

  it('acknowledges the exact upload and provisions the owner database without an API key', async () => {
    expect(imported).toEqual({
      message: 'Database imported successfully',
      db_name: database,
      size_bytes: snapshot.length,
    });
    expect((await account.databases.list()).databases.map((item) => item.dbName)).toContain(
      database
    );
    expect((await account.databases.get(database)).database).toMatchObject({
      dbName: database,
      tables: 3,
      totalRecords: 6,
    });
    await expect(account.databases.getApiKey(database)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('preserves WAL rows, BLOB/NULL/NUL text, views, foreign keys, indexes and triggers', async () => {
    const records = await account.sql.execute(
      database,
      'SELECT id,hex(label),hex(payload),typeof(optional) FROM items ORDER BY id'
    );
    expect(records.rows).toEqual([
      [1, Buffer.from("O'Brien Ω\0tail").toString('hex').toUpperCase(), '00FF', 'null'],
      [2, Buffer.from('committed-in-wal').toString('hex').toUpperCase(), '0102', 'null'],
    ]);
    expect((await account.sql.execute(database, 'SELECT COUNT(*) FROM item_view')).rows).toEqual([
      [2],
    ]);
    expect((await account.sql.execute(database, 'PRAGMA foreign_key_check')).rows ?? []).toEqual(
      []
    );
    const objects = await account.objects.get(database);
    expect(objects.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'related_lookup', tableName: 'related' }),
      ])
    );
    expect(objects.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'audit_insert', tableName: 'items' }),
      ])
    );
  });

  it('retains AUTOINCREMENT state and executes the preserved trigger on later writes', async () => {
    await account.sql.execute(
      database,
      "INSERT INTO items(label,payload) VALUES('new item',X'03')"
    );
    expect(
      (await account.sql.execute(database, "SELECT id FROM items WHERE label='new item'")).rows
    ).toEqual([[11]]);
    expect((await account.sql.execute(database, 'SELECT COUNT(*) FROM audit')).rows).toEqual([[4]]);
  });

  it('refuses to replace an existing database or its records', async () => {
    await expect(
      account.databases.importSQLite({ db_name: database, file: snapshot })
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await account.sql.execute(database, 'SELECT COUNT(*) FROM items')).rows).toEqual([[3]]);
  });

  it('imports the same name from a Blob for another owner without sharing data', async () => {
    await otherOwner.databases.importSQLite({
      db_name: database,
      file: new Blob([Uint8Array.from(snapshot)]),
    });
    otherCreated = true;
    await otherOwner.sql.execute(database, "UPDATE items SET label='other owner' WHERE id=1");
    expect((await account.sql.execute(database, 'SELECT COUNT(*) FROM items')).rows).toEqual([[3]]);
    expect(
      (await otherOwner.sql.execute(database, 'SELECT label FROM items WHERE id=1')).rows
    ).toEqual([['other owner']]);
    expect((await otherOwner.databases.get(database)).database.userId).not.toBe(
      (await account.databases.get(database)).database.userId
    );
  });

  it('round-trips exported bytes through import under a new name', async () => {
    const exported = await account.exports.sqlite(database);
    await account.databases.importSQLite(
      { db_name: copyDatabase, file: exported.data },
      { timeout: 75_000 }
    );
    created.push(copyDatabase);
    const query = 'SELECT id,hex(label),hex(payload),typeof(optional) FROM items ORDER BY id';
    expect((await account.sql.execute(copyDatabase, query)).rows).toEqual(
      (await account.sql.execute(database, query)).rows
    );
  });

  it('preserves server integrity/foreign-key errors and does not register invalid snapshots', async () => {
    const corrupt = new Uint8Array(512);
    corrupt.set(new TextEncoder().encode('SQLite format 3\0'));
    await expect(
      account.databases.importSQLite({ db_name: 'invalid_structure', file: corrupt })
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      account.databases.importSQLite({ db_name: 'invalid_foreign_key', file: foreignKeyViolation })
    ).rejects.toBeInstanceOf(BadRequestError);
    const names = (await account.databases.list()).databases.map((item) => item.dbName);
    expect(names).not.toContain('invalid_structure');
    expect(names).not.toContain('invalid_foreign_key');
  });

  it('requires an owner JWT even when a valid scoped key is configured', async () => {
    const key = await account.databases.createApiKey(database);
    const application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await expect(
      application.databases.importSQLite({ db_name: 'key_import', file: snapshot })
    ).rejects.toBeInstanceOf(AuthError);
    application.setAuthToken('invalid.jwt');
    await expect(
      application.databases.importSQLite({ db_name: 'invalid_session', file: snapshot })
    ).rejects.toBeInstanceOf(AuthError);
  });
});
