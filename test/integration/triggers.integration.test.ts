import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import {
  AuthError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../src/errors';
import { CreateTriggerPayload, CreateTriggerResponse, DropTriggerResponse } from '../../src/types';
const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;

suite('Native trigger management against the isolated Go backend', () => {
  const database = 'sdk_triggers';
  let owner: NebulaClient;
  let application: NebulaClient;
  let otherOwner: NebulaClient;
  const insert: CreateTriggerPayload = {
    name: 'audit_insert',
    table_name: 'ITEMS',
    event: 'INSERT',
    when: "NEW.label <> 'ignored'",
    body: "INSERT INTO audit (item_id, event) VALUES (NEW.id, 'insert');",
  };
  async function account(username: string) {
    const client = new NebulaClient({ baseURL: baseURL! });
    const email = `${username}-${randomUUID()}@example.test`,
      password = 'sdk-trigger-test-password';
    await client.auth.signup({ username, email, password });
    client.setAuthToken((await client.auth.login({ email, password })).token);
    return client;
  }
  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('Trigger tests require an isolated loopback backend.');
    owner = await account('trigger_builder');
    otherOwner = await account('trigger_other');
    await owner.databases.create({ db_name: database });
    await owner.databases.create({ db_name: 'sdk_triggers_other' });
    await otherOwner.databases.create({ db_name: database });
    const key = await owner.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await application.sql.execute(
      database,
      'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, note TEXT)'
    );
    await application.sql.execute(database, 'CREATE TABLE audit (item_id INTEGER, event TEXT)');
    await otherOwner.sql.execute(database, 'CREATE TABLE items (id INTEGER PRIMARY KEY)');
  }, 15000);
  afterAll(async () => {
    if (owner?.getAuthToken()) {
      await owner.databases.delete(database);
      await owner.databases.delete('sdk_triggers_other');
    }
    if (otherOwner?.getAuthToken()) await otherOwner.databases.delete(database);
  });
  it('compiles without executing actions, returns canonical metadata, and runs only when its condition matches', async () => {
    const result: CreateTriggerResponse = await owner.objects.createTrigger(database, insert);
    expect(result).toEqual({
      message: 'Trigger created successfully',
      db_name: database,
      trigger: {
        name: 'audit_insert',
        tableName: 'items',
        sql:
          'CREATE TRIGGER "audit_insert" AFTER INSERT ON "items"\nWHEN (NEW.label <> \'ignored\'\n)\nBEGIN\n' +
          insert.body +
          '\nEND',
      },
    });
    expect((await application.objects.get(database)).triggers).toContainEqual(result.trigger);
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM audit')).rows).toEqual([
      [0],
    ]);
    await application.sql.execute(
      database,
      "INSERT INTO items VALUES (1, 'first', ''), (2, 'ignored', '')"
    );
    expect((await application.sql.execute(database, 'SELECT * FROM audit')).rows).toEqual([
      [1, 'insert'],
    ]);
  });
  it('resolves UPDATE OF columns and fires only for selected columns', async () => {
    const result = await application.objects.createTrigger(database, {
      name: 'audit_update',
      table_name: 'items',
      event: 'UPDATE',
      update_of: ['LABEL'],
      body: "INSERT INTO audit VALUES (NEW.id, 'update');",
    });
    expect(result.trigger.sql).toContain('AFTER UPDATE OF "label" ON "items"');
    await application.sql.execute(database, "UPDATE items SET note='changed' WHERE id=1");
    expect((await application.sql.execute(database, 'SELECT COUNT(*) FROM audit')).rows).toEqual([
      [1],
    ]);
    await application.sql.execute(database, "UPDATE items SET label='second' WHERE id=1");
    expect(
      (await application.sql.execute(database, 'SELECT event FROM audit ORDER BY rowid')).rows
    ).toEqual([['insert'], ['update']]);
    await owner.objects.dropTrigger(database, 'audit_update');
  });
  it('supports BEFORE DELETE and OLD references through an API key', async () => {
    const result = await application.objects.createTrigger(database, {
      name: 'audit_delete',
      table_name: 'items',
      event: 'DELETE',
      timing: 'BEFORE',
      body: "INSERT INTO audit VALUES (OLD.id, 'delete');",
    });
    expect(result.trigger.sql).toContain('BEFORE DELETE ON "items"');
    await application.sql.execute(database, 'DELETE FROM items WHERE id=1');
    expect(
      (await application.sql.execute(database, 'SELECT * FROM audit ORDER BY rowid')).rows
    ).toEqual([
      [1, 'insert'],
      [1, 'update'],
      [1, 'delete'],
    ]);
    await application.objects.dropTrigger(database, result.trigger.name);
  });
  it('rejects invalid references and injected statement tails without persisting partial definitions', async () => {
    await expect(
      application.objects.createTrigger(database, {
        ...insert,
        name: 'bad_reference',
        body: 'SELECT NEW.missing;',
      })
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      application.objects.createTrigger(database, {
        ...insert,
        name: 'bad_tail',
        body: 'SELECT 1; END; DROP TABLE items; --',
      })
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(
      (await application.objects.get(database)).triggers.map((trigger) => trigger.name)
    ).toEqual(['audit_insert']);
    await expect(
      application.objects.createTrigger(database, { ...insert, name: 'AUDIT_INSERT' })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      application.objects.createTrigger(database, {
        ...insert,
        name: 'missing_target',
        table_name: 'absent',
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(application.objects.dropTrigger(database, 'absent')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
  it('drops legacy quoted SQL-created trigger names and returns their canonical names', async () => {
    await owner.sql.execute(
      database,
      'CREATE TRIGGER "Legacy odd""trigger" AFTER INSERT ON items BEGIN SELECT 1; END'
    );
    const result: DropTriggerResponse = await application.objects.dropTrigger(
      database,
      'LEGACY ODD"TRIGGER'
    );
    expect(result).toEqual({
      message: 'Trigger dropped successfully',
      db_name: database,
      trigger_name: 'Legacy odd"trigger',
    });
  });
  it('preserves tenant ownership, API-key database scope, and failed JWT authentication', async () => {
    await otherOwner.objects.createTrigger(database, {
      ...insert,
      body: 'SELECT NEW.id;',
      when: undefined,
    });
    await otherOwner.objects.dropTrigger(database, insert.name);
    expect((await owner.objects.get(database)).triggers.map((trigger) => trigger.name)).toContain(
      insert.name
    );
    await expect(
      application.objects.createTrigger('sdk_triggers_other', insert)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      application.objects.dropTrigger('sdk_triggers_other', insert.name)
    ).rejects.toBeInstanceOf(ForbiddenError);
    application.setAuthToken('invalid.jwt');
    try {
      await expect(application.objects.dropTrigger(database, insert.name)).rejects.toBeInstanceOf(
        AuthError
      );
    } finally {
      application.setAuthToken(null);
    }
  });
  it('stops future actions while preserving records and earlier effects, and reports repeated deletion', async () => {
    const result = await application.objects.dropTrigger(database, 'AUDIT_INSERT');
    expect(result.trigger_name).toBe(insert.name);
    await application.sql.execute(database, "INSERT INTO items VALUES (3, 'after drop', '')");
    expect(
      (
        await application.sql.execute(
          database,
          'SELECT (SELECT COUNT(*) FROM audit), (SELECT COUNT(*) FROM items)'
        )
      ).rows
    ).toEqual([[3, 2]]);
    expect((await application.objects.get(database)).triggers).toEqual([]);
    await expect(owner.objects.dropTrigger(database, insert.name)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
