import { createHash, randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { AuthError, ConflictError, NotFoundError } from '../../src/errors';
import { DatabaseBackup } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Managed backups against the isolated Go backend', () => {
  const source = 'sdk_backup_source';
  const destination = 'sdk_backup_restore';
  const recovered = 'sdk_backup_recovered';
  const id = randomUUID();
  const emptyId = randomUUID();
  let account: NebulaClient;
  let other: NebulaClient;
  let backup: DatabaseBackup;

  async function owner(username: string): Promise<NebulaClient> {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`;
    const password = 'sdk-backup-test-password';
    await client.auth.signup({ username, email, password });
    client.setAuthToken((await client.auth.login({ email, password })).token);
    return client;
  }

  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Backup integration tests require an isolated loopback backend.');
    }
    account = await owner('backup_builder');
    other = await owner('backup_other');
    await account.databases.create({ db_name: source });
    for (const sql of [
      'PRAGMA journal_mode=WAL',
      'CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,label TEXT,payload BLOB,optional TEXT); CREATE TABLE audit(item_id INTEGER); CREATE INDEX label_lookup ON items(label); CREATE VIEW item_view AS SELECT * FROM items;',
      'CREATE TRIGGER audit_insert AFTER INSERT ON items BEGIN INSERT INTO audit VALUES(NEW.id); END;',
      "INSERT INTO items(id,label,payload) VALUES(10,'original Ω',X'00FF'); DELETE FROM items; INSERT INTO items(label,payload) VALUES('saved',X'00FF')",
    ])
      await account.sql.execute(source, sql);
    // The Studio table reader installs the canonical hidden timestamp table.
    await account.schema.listTables(source);
  }, 15000);

  // test-backend.mjs owns this disposable server and removes its full storage directory.
  // Avoid extra HTTP cleanup that would exhaust the real 50-request/minute IP limit.

  it('creates a native snapshot and replays the original after later writes', async () => {
    backup = (await account.backups.create(source, { backup_id: id })).backup;
    expect(backup).toMatchObject({ backup_id: id, db_name: source, status: 'ready' });
    expect(backup.size_bytes).toBeGreaterThanOrEqual(512);
    expect(backup.sha256).toMatch(/^[a-f0-9]{64}$/);
    await account.sql.execute(source, "UPDATE items SET label='live changed'");
    expect((await account.backups.create(source, { backup_id: id })).backup).toEqual(backup);
    expect((await account.backups.get(id)).backup).toEqual(backup);
  });

  it('paginates account and source history, including empty pages', async () => {
    const page = await account.backups.list({ db_name: source, limit: 1 });
    expect(page).toEqual({ backups: [backup], pagination: { total: 1, limit: 1, offset: 0 } });
    expect((await account.backups.list()).backups).toContainEqual(backup);
    expect(await account.backups.list({ db_name: source, limit: 1, offset: 1 })).toEqual({
      backups: [],
      pagination: { total: 1, limit: 1, offset: 1 },
    });
  });

  it('downloads the saved bytes with their original digest and size', async () => {
    const downloaded = await account.backups.download(id);
    expect(downloaded.backup).toEqual(backup);
    expect(downloaded.filename).toBe(`${id}.db`);
    expect(downloaded.data.byteLength).toBe(backup.size_bytes);
    expect(createHash('sha256').update(downloaded.data).digest('hex')).toBe(backup.sha256);
  });

  it('restores rows, SQLite objects, sequence state and native metadata into a new database', async () => {
    expect(await account.backups.restore(id, { db_name: destination })).toMatchObject({
      backup_id: id,
      db_name: destination,
      size_bytes: backup.size_bytes,
    });
    expect(
      (
        await account.sql.execute(
          destination,
          'SELECT id,label,hex(payload),typeof(optional) FROM item_view'
        )
      ).rows
    ).toEqual([[11, 'saved', '00FF', 'null']]);
    const objects = await account.objects.get(destination);
    expect(objects.indexes).toContainEqual(expect.objectContaining({ name: 'label_lookup' }));
    expect(objects.triggers).toContainEqual(expect.objectContaining({ name: 'audit_insert' }));
    await account.sql.execute(destination, "INSERT INTO items(label) VALUES('restored write')");
    expect(
      (await account.sql.execute(destination, "SELECT id FROM items WHERE label='restored write'"))
        .rows
    ).toEqual([[12]]);
    expect((await account.sql.execute(destination, 'SELECT COUNT(*) FROM audit')).rows).toEqual([
      [3],
    ]);
    expect(
      (await account.schema.listTables(destination)).tables.map((table) => table.name)
    ).toEqual(expect.arrayContaining(['items', 'audit']));
    await expect(account.databases.getApiKey(destination)).rejects.toBeInstanceOf(NotFoundError);
    await expect(account.backups.restore(id, { db_name: destination })).rejects.toMatchObject({
      name: 'ConflictError',
      errorData: { code: 'database_exists' },
    });
  });

  it('isolates history and identifiers across owners and refuses API-key-only access', async () => {
    expect((await other.backups.list()).backups).toEqual([]);
    await expect(other.backups.get(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(other.backups.restore(id, { db_name: 'other_copy' })).rejects.toBeInstanceOf(
      NotFoundError
    );
    await other.backups.delete(id);
    expect((await account.backups.get(id)).backup).toEqual(backup);
    const apiKey = (await account.databases.createApiKey(source)).api_key;
    const application = new NebulaClient({ baseURL: baseURL!, apiKey });
    await expect(
      application.backups.create(source, { backup_id: randomUUID() })
    ).rejects.toBeInstanceOf(AuthError);
    await expect(application.backups.list()).rejects.toBeInstanceOf(AuthError);
    await expect(application.backups.download(id)).rejects.toBeInstanceOf(AuthError);
  });

  it('keeps backups and replays accessible after deleting the source', async () => {
    await account.databases.delete(source);
    expect((await account.backups.list({ db_name: source })).backups).toEqual([backup]);
    expect((await account.backups.create(source, { backup_id: id })).backup).toEqual(backup);
    await account.backups.restore(id, { db_name: recovered });
    expect((await account.sql.execute(recovered, 'SELECT label FROM items')).rows).toEqual([
      ['saved'],
    ]);
  });

  it('supports an empty native database and permanent deleted-ID reservation', async () => {
    await account.databases.create({ db_name: 'sdk_backup_empty' });
    const empty = await account.backups.create('sdk_backup_empty', { backup_id: emptyId });
    expect(empty.backup.size_bytes).toBeGreaterThanOrEqual(512);
    await account.backups.delete(emptyId);
    await account.backups.delete(emptyId);
    await expect(account.backups.get(emptyId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      account.backups.create('sdk_backup_empty', { backup_id: emptyId })
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await account.databases.get(recovered)).database.totalRecords).toBeGreaterThan(0);
  });
});
