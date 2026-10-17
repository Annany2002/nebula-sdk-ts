import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'nebula-sdk-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmEnvironment = { ...process.env, npm_config_cache: join(temporary, 'npm-cache') };

try {
  const [packed] = JSON.parse(
    execFileSync(npm, ['pack', '--json', '--pack-destination', temporary], {
      cwd: sdk,
      encoding: 'utf8',
      env: npmEnvironment,
    })
  );
  const files = packed.files.map(({ path }) => path);
  for (const expected of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/modules/account.js',
    'dist/modules/admin.d.ts',
    'dist/types/admin.d.ts',
    'README.md',
    'LICENSE',
  ]) {
    assert(files.includes(expected), `Package is missing ${expected}`);
  }
  assert(
    files.every(
      (path) => path.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE'].includes(path)
    ),
    'Package contains unexpected files outside the public distribution'
  );

  execFileSync(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      join(temporary, packed.filename),
    ],
    { cwd: temporary, env: npmEnvironment, stdio: 'inherit' }
  );

  await writeFile(
    join(temporary, 'consumer.cjs'),
    `const assert = require('node:assert/strict');
const { NebulaClient, ConflictError, ApiError, NetworkError, RequestAbortedError } = require('nebula-sdk-ts');
const client = new NebulaClient({ baseURL: 'http://localhost:8080' });
assert.equal(typeof client.auth.login, 'function');
assert.equal(typeof client.account.getSummary, 'function');
for (const method of ['listUsers', 'getUser', 'getStats', 'suspendUser', 'activateUser', 'listAuditEvents']) {
  assert.equal(typeof client.admin[method], 'function');
}
for (const method of ['verifyEmail', 'resendVerification', 'requestEmailChange']) {
  assert.equal(typeof client.auth[method], 'function');
}
assert.equal(typeof client.records.list, 'function');
assert.equal(typeof client.databases.get, 'function');
assert.equal(typeof client.databases.importSQLite, 'function');
assert.equal(typeof client.schema.alterTable, 'function');
assert.equal(typeof client.sql.execute, 'function');
assert.equal(typeof client.analytics.get, 'function');
assert.equal(typeof client.diagrams.get, 'function');
assert.equal(typeof client.objects.get, 'function');
assert.equal(typeof client.objects.createIndex, 'function');
assert.equal(typeof client.objects.dropIndex, 'function');
assert.equal(typeof client.objects.createTrigger, 'function');
assert.equal(typeof client.objects.dropTrigger, 'function');
assert.equal(typeof client.exports.sql, 'function');
assert.equal(typeof client.exports.sqlite, 'function');
for (const method of ['create', 'list', 'get', 'download', 'restore', 'delete']) {
  assert.equal(typeof client.backups[method], 'function');
}
assert(new ConflictError('duplicate') instanceof ApiError);
assert(new RequestAbortedError() instanceof NetworkError);
async function checkImport() {
  const bytes = Buffer.alloc(512);
  bytes.write('SQLite format 3\\0');
  let requests = 0;
  const owner = new NebulaClient({ baseURL: 'http://localhost:8080', fetch: async (url, init) => {
    requests++;
    assert.equal(url, 'http://localhost:8080/api/v1/databases/import/sqlite');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer package.jwt');
    assert(!Object.hasOwn(init.headers, 'Content-Type'));
    assert(init.body instanceof FormData);
    assert.equal(init.body.get('db_name'), 'restored');
    assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), bytes);
    return new Response(JSON.stringify({ message: 'Database imported successfully', db_name: 'restored', size_bytes: 512 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } });
  owner.setAuthToken('package.jwt');
  assert.equal((await owner.databases.importSQLite({ db_name: 'restored', file: bytes })).size_bytes, 512);
  assert.equal(requests, 1);
}
async function checkVerification() {
  const token = 'A'.repeat(43);
  const owner = new NebulaClient({ baseURL: 'http://localhost:8080', fetch: async (url, init) => {
    if (url.endsWith('/auth/verify-email')) {
      assert.equal(init.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(init.body), { token });
      return new Response(JSON.stringify({ message: 'Verified' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(init.headers.Authorization, 'Bearer package.jwt');
    assert.deepEqual(JSON.parse(init.body), { email: 'new@example.test', current_password: 'package-password' });
    return new Response(JSON.stringify({ message: 'Pending', pending_email: 'new@example.test' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  } });
  owner.setAuthToken('package.jwt');
  assert.equal((await owner.auth.verifyEmail(token)).message, 'Verified');
  assert.equal(owner.getAuthToken(), 'package.jwt');
  const pending = await owner.auth.requestEmailChange({ email: 'new@example.test', current_password: 'package-password' });
  assert.equal(pending.pending_email, 'new@example.test');
  assert.equal(pending.user, undefined);
}
async function checkManagement() {
  const user = { user_id: 'owner', username: 'builder', email: 'owner@example.test', created_at: '2026-10-17T00:00:00Z', email_verified: false, verification_required: false, role: 'user', status: 'active', database_count: 1 };
  const owner = new NebulaClient({ baseURL: 'http://localhost:8080', fetch: async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer package.jwt');
    assert.equal(init.cache, 'no-store');
    const data = url.endsWith('/account/summary') ? { summary: { database_count: 1, active_api_key_count: 0, ready_backup_count: 2 } } : { user: { ...user, status: url.endsWith('/suspend') ? 'suspended' : 'active', password_hash: 'must-not-escape' } };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  owner.setAuthToken('package.jwt');
  assert.equal((await owner.account.getSummary()).summary.ready_backup_count, 2);
  assert.equal((await owner.admin.suspendUser('owner')).user.status, 'suspended');
  assert.equal((await owner.admin.getUser('owner')).user.password_hash, undefined);
}
Promise.all([checkImport(), checkVerification(), checkManagement()]).catch((error) => { console.error(error); process.exitCode = 1; });
`
  );
  execFileSync(process.execPath, ['consumer.cjs'], { cwd: temporary, stdio: 'inherit' });

  await writeFile(
    join(temporary, 'consumer.ts'),
    `import { NebulaClient, NebulaClientConfig, ConflictError, ApiError, RecordListResponse, RecordMutationResponse, SchemaCreateResponse, SchemaInfoResponse, TableListResponse, ApiKeyMetadataResponse, ApiKeyResponse, SignupResponse, User, ProtectedHealthResponse, SQLQueryResult, DatabaseAnalytics, ServiceMetrics, ServiceMetricBucket, AdvisorIssue, SchemaDiagram, TableDiagramInfo, ForeignKeyInfo, TableColumnInfo, ForeignKeyAction, DatabaseObjects, IndexInfo, TriggerInfo, CreateIndexPayload, CreateIndexResponse, DropIndexResponse, TriggerEvent, TriggerTiming, CreateTriggerPayload, CreateTriggerResponse, DropTriggerResponse, SQLExport, SQLiteExport, DatabaseDetails, DatabaseDetailsResponse, AlterColumnDefinition, AlterTableOperation, AlterTablePayload, AlterTableResponse } from 'nebula-sdk-ts';
const config: NebulaClientConfig = { baseURL: 'http://localhost:8080' };
const client: NebulaClient = new NebulaClient(config);
const error: ApiError = new ConflictError('duplicate');
void client;
void error;
interface Item { item_key: string; label: string }
async function checkContracts() {
  const managementOptions: import('nebula-sdk-ts').ManagementRequestOptions = { timeout: 15000, signal: new AbortController().signal };
  const summaryResponse: import('nebula-sdk-ts').AccountSummaryResponse = await client.account.getSummary(managementOptions);
  const resourceCount: number = summaryResponse.summary.database_count;
  const filters: import('nebula-sdk-ts').AdminUserListOptions = { q: 'builder', role: 'user', status: 'active', limit: 20 };
  const accounts: import('nebula-sdk-ts').AdminUserListResponse = await client.admin.listUsers(filters, managementOptions);
  const account: import('nebula-sdk-ts').AdminUserResponse = await client.admin.getUser('owner');
  const role: import('nebula-sdk-ts').PlatformRole = account.user.role;
  const status: import('nebula-sdk-ts').AccountStatus = account.user.status;
  const platform: import('nebula-sdk-ts').PlatformStatsResponse = await client.admin.getStats();
  const tableCount: number | null = platform.stats.total_tables;
  const history: import('nebula-sdk-ts').AdminAuditListResponse = await client.admin.listAuditEvents({ action: 'suspend', actor_user_id: 'operator' });
  await client.admin.suspendUser('owner', managementOptions);
  await client.admin.activateUser('owner', managementOptions);
  // @ts-expect-error A platform role cannot be assigned through a profile update.
  await client.auth.updateProfile({ role: 'admin' });
  // @ts-expect-error Summary scope comes from the JWT, not a supplied account ID.
  await client.account.getSummary({ user_id: 'other' });
  // @ts-expect-error Unsupported roles must not enter list filters.
  await client.admin.listUsers({ role: 'owner' });
  // @ts-expect-error Audit history covers access transitions only.
  await client.admin.listAuditEvents({ action: 'delete' });
  // @ts-expect-error Safe administrator metadata exposes no API key.
  const credential: string = account.user.api_key;
  void [resourceCount, accounts, role, status, tableCount, history, credential];

  const authOptions: import('nebula-sdk-ts').AuthRequestOptions = { timeout: 35000, signal: new AbortController().signal };
  const confirmed: import('nebula-sdk-ts').EmailVerificationResponse = await client.auth.verifyEmail('A'.repeat(43), authOptions);
  await client.auth.resendVerification('owner@example.test', authOptions);
  const emailChange: import('nebula-sdk-ts').EmailChangePayload = { email: 'new@example.test', current_password: 'current-password' };
  const profileChange: import('nebula-sdk-ts').UpdateProfileResponse = await client.auth.requestEmailChange(emailChange, authOptions);
  if ('pending_email' in profileChange) {
    const pending: string = profileChange.pending_email;
    // @ts-expect-error A pending email change has no updated user.
    const premature: User = profileChange.user;
    void [pending, premature];
  } else {
    const immediate: User = profileChange.user;
    void immediate;
  }
  const usernameChange: import('nebula-sdk-ts').UserProfileResponse = await client.auth.updateProfile({ username: 'builder' });
  const maybePending = await client.auth.updateProfile({ email: 'new@example.test', current_password: 'current-password' });
  // @ts-expect-error Email changes must be narrowed before reading an updated user.
  const prematureUser: User = maybePending.user;
  const wait: number | undefined = new (await import('nebula-sdk-ts')).RateLimitError().retryAfterSeconds;
  void [confirmed, usernameChange, prematureUser, wait];
  const backupOptions: import('nebula-sdk-ts').BackupRequestOptions = { timeout: 60000, signal: new AbortController().signal };
  const backupPayload: import('nebula-sdk-ts').CreateBackupPayload = { backup_id: '12345678-1234-1234-1234-123456789abc' };
  const backupResult: import('nebula-sdk-ts').BackupResponse = await client.backups.create('app', backupPayload, backupOptions);
  const backupMetadata: import('nebula-sdk-ts').DatabaseBackup = backupResult.backup;
  const backupStatus: 'creating' | 'ready' | 'deleting' = backupMetadata.status;
  const backupPage: import('nebula-sdk-ts').BackupListResponse = await client.backups.list({ db_name: 'app', limit: 10, offset: 0 }, backupOptions);
  const downloaded: import('nebula-sdk-ts').BackupDownload = await client.backups.download(backupMetadata.backup_id, backupOptions);
  const restorePayload: import('nebula-sdk-ts').RestoreBackupPayload = { db_name: 'copy' };
  const restoredBackup: import('nebula-sdk-ts').RestoreBackupResponse = await client.backups.restore(backupMetadata.backup_id, restorePayload);
  await client.backups.get(backupMetadata.backup_id);
  await client.backups.delete(backupMetadata.backup_id);
  // @ts-expect-error Creation requires a retained UUID; no implicit creation intent is generated.
  await client.backups.create('app', {});
  // @ts-expect-error Restores never support overwriting live databases.
  await client.backups.restore(backupMetadata.backup_id, { db_name: 'copy', overwrite: true });
  // @ts-expect-error Backup pages are envelopes, not arrays.
  const bareBackups: import('nebula-sdk-ts').DatabaseBackup[] = backupPage;
  // @ts-expect-error Deleted identifiers are not exposed as visible metadata states.
  const deletedStatus: import('nebula-sdk-ts').DatabaseBackup['status'] = 'deleted';
  const machineCode: string | undefined = error.errorData?.code;
  void [backupStatus, backupPage, downloaded, restoredBackup, bareBackups, deletedStatus, machineCode];
  const detailResult: DatabaseDetailsResponse = await client.databases.get('app');
  const detail: DatabaseDetails = detailResult.database;
  const detailCount: number = detail.totalRecords;
  const detailSize: number = detail.sizeBytes;
  // @ts-expect-error Database details expose a key prefix, not the credential.
  const secret: string = detail.apiKey;
  void [detailCount, detailSize, secret];
  const page: RecordListResponse<Item> = await client.records.list<Item>('app', 'items');
  const label: string = page.records[0].label;
  const total: number = page.pagination.total;
  // @ts-expect-error Listing is a page, not an array.
  const oldPage: Item[] = await client.records.list<Item>('app', 'items');
  const created: RecordMutationResponse = await client.records.create('app', 'items', { label });
  const key: string | number = created.record_id;
  // @ts-expect-error Mutation acknowledgements are not complete records.
  const oldRow: Item = await client.records.update('app', 'items', key, { label });
  const row: Item = await client.records.get<Item>('app', 'items', 'text-key');
  const unknownRow = await client.records.get('app', 'items', 0);
  // @ts-expect-error No numeric id is assumed for arbitrary rows.
  const oldId: number = unknownRow.id;
  const table: SchemaCreateResponse = await client.schema.define('app', { table_name: 'items', schema: [{ name: 'label', type: 'TEXT' }] });
  const schema: SchemaInfoResponse = await client.schema.getSchema('app', table.table_name);
  const addedColumn: AlterColumnDefinition = { name: 'stock', type: 'INTEGER', not_null: true, default_value: '0' };
  const operation: AlterTableOperation = { action: 'add_column', column: addedColumn };
  const batch: AlterTablePayload = { operations: [operation, { action: 'rename_table', new_table_name: 'inventory' }] };
  const alteration: AlterTableResponse = await client.schema.alterTable('app', 'items', batch);
  const finalTable: string = alteration.table_name;
  const statements: string[] = alteration.statements;
  const alteredPrimary: boolean | undefined = alteration.schema?.[0].pk;
  // @ts-expect-error Default values are SQL expression strings, not numeric JavaScript values.
  const numericDefault: AlterColumnDefinition = { name: 'stock', type: 'INTEGER', default_value: 0 };
  // @ts-expect-error Rename operations require both column names.
  const missingRename: AlterTableOperation = { action: 'rename_column', new_name: 'label' };
  // @ts-expect-error The endpoint does not support changing column types.
  const unsupportedAlteration: AlterTableOperation = { action: 'modify_column', column: addedColumn };
  void [finalTable, statements, alteredPrimary, numericDefault, missingRename, unsupportedAlteration];
  const primary: boolean = schema.schema[0].pk;
  const tables: TableListResponse = await client.schema.listTables('app');
  const sqlitePrimary: number = tables.tables[0].columns[0].pk;
  const metadata: ApiKeyMetadataResponse = await client.databases.getApiKey('app');
  // @ts-expect-error Metadata does not expose the secret.
  const oldKey: string = metadata.api_key;
  const generated: ApiKeyResponse = await client.databases.createApiKey('app');
  const signup: SignupResponse = await client.auth.signup({ username: 'builder', email: 'a@example.test', password: 'test-password' });
  const user: User = await client.auth.getMe();
  // @ts-expect-error Public user metadata does not expose passwords.
  const password: string = user.password;
  const health: ProtectedHealthResponse = await client.auth.healthP();
  const sql: SQLQueryResult<[number, string | null]> = await client.sql.execute<[number, string | null]>('app', 'SELECT id, label FROM items');
  const count: number = sql.rowCount;
  const affected: number = sql.rowsAffected;
  const elapsed: number = sql.executionMs;
  const cells: [number, string | null][] | undefined = sql.rows;
  if (sql.rows) {
    const id: number = sql.rows[0][0];
    // @ts-expect-error SQL rows are tuples, not named objects.
    const oldSQLLabel = sql.rows[0].label;
    void [id, oldSQLLabel];
  }
  const rawSQL = await client.sql.execute('app', 'SELECT 1');
  if (rawSQL.rows) {
    // @ts-expect-error Default SQL cell types require narrowing.
    const unsafeCell: number = rawSQL.rows[0][0];
    void unsafeCell;
  }
  void [count, affected, elapsed, cells];
  const analytics: DatabaseAnalytics = await client.analytics.get('app');
  const service: ServiceMetrics = analytics.services[0];
  const bucket: ServiceMetricBucket | undefined = service.history[0];
  const finding: AdvisorIssue | undefined = analytics.advisor[0];
  const traffic: number = analytics.totalRequests;
  const rate: number = analytics.successRate;
  const window: string = analytics.timeframe;
  const tableName: string | undefined = finding?.tableName;
  // @ts-expect-error Analytics fields match the backend camelCase contract.
  const oldTraffic: number = analytics.total_requests;
  // @ts-expect-error The endpoint does not accept configurable reporting windows.
  await client.analytics.get('app', { timeframe: '7d' });
  void [bucket, traffic, rate, window, tableName, oldTraffic];
  const diagram: SchemaDiagram = await client.diagrams.get('app');
  const diagramTable: TableDiagramInfo = diagram.tables[0];
  const diagramColumn: TableColumnInfo = diagramTable.columns[0];
  const foreignKey: ForeignKeyInfo = diagramTable.foreignKeys[0];
  const action: ForeignKeyAction = foreignKey.onDelete;
  const columnId: string = diagramColumn.cid;
  const defaultSQL: string | null = diagramColumn.dflt_value;
  const foreignKeyCount: number = diagram.totalForeignKeys;
  // @ts-expect-error PRAGMA primary-key metadata is numeric, not boolean.
  const booleanPrimary: boolean = diagramColumn.pk;
  // @ts-expect-error Relationships are table-level foreignKeys, not a relations array.
  const relations = diagram.relations;
  void [action, columnId, defaultSQL, foreignKeyCount, booleanPrimary, relations];
  const objects: DatabaseObjects = await client.objects.get('app');
  const index: IndexInfo = objects.indexes[0];
  const trigger: TriggerInfo = objects.triggers[0];
  const unique: boolean = index.unique;
  const indexSQL: string = index.sql;
  const target: string = trigger.tableName;
  // @ts-expect-error Object inspection does not include table metadata.
  const objectTables = objects.tables;
  const indexPayload: CreateIndexPayload = { name: 'lookup', table_name: 'items', columns: ['label'], unique: true };
  const creation: CreateIndexResponse = await client.objects.createIndex('app', indexPayload);
  const droppedIndex: DropIndexResponse = await client.objects.dropIndex('app', creation.index.name);
  const droppedName: string = droppedIndex.index_name;
  // @ts-expect-error Index creation requires a target table and ordered columns.
  await client.objects.createIndex('app', { name: 'lookup' });
  // @ts-expect-error Uniqueness is a boolean, not a string.
  const invalidUnique: CreateIndexPayload = { ...indexPayload, unique: 'true' };
  void [creation, droppedName, invalidUnique];
  const event: TriggerEvent = 'UPDATE';
  const timing: TriggerTiming = 'AFTER';
  const triggerPayload: CreateTriggerPayload = { name: 'audit_changes', table_name: 'items', event, timing, update_of: ['label'], when: 'NEW.label <> OLD.label', body: 'SELECT NEW.label;' };
  const triggerCreation: CreateTriggerResponse = await client.objects.createTrigger('app', triggerPayload);
  const triggerMetadata: TriggerInfo = triggerCreation.trigger;
  const triggerDrop: DropTriggerResponse = await client.objects.dropTrigger('app', triggerMetadata.name);
  const triggerName: string = triggerDrop.trigger_name;
  // @ts-expect-error Trigger creation requires an event and SQL body.
  await client.objects.createTrigger('app', { name: 'audit_changes', table_name: 'items' });
  // @ts-expect-error Native creation does not accept INSTEAD OF view triggers.
  const invalidTiming: CreateTriggerPayload = { ...triggerPayload, timing: 'INSTEAD OF' };
  // @ts-expect-error UPSERT is not a trigger event.
  const invalidEvent: TriggerEvent = 'UPSERT';
  // @ts-expect-error UPDATE OF accepts an array of column names.
  const invalidColumns: CreateTriggerPayload = { ...triggerPayload, update_of: 'label' };
  void [triggerMetadata, triggerName, invalidTiming, invalidEvent, invalidColumns];
  void [unique, indexSQL, target, objectTables];
  const dump: SQLExport = await client.exports.sql('app');
  const snapshot: SQLiteExport = await client.exports.sqlite('app');
  const dumpSQL: string = dump.sql;
  const bytes: Uint8Array = snapshot.data;
  const filename: string = snapshot.filename;
  // @ts-expect-error SQL exports are JSON envelopes, not bare strings.
  const bareSQL: string = await client.exports.sql('app');
  // @ts-expect-error Snapshots are byte arrays, not parsed record arrays.
  const parsedRows: Item[] = snapshot.data;
  // @ts-expect-error Import is a database provisioning method, not an export method.
  await client.exports.restore('app', snapshot);
  const importPayload: import('nebula-sdk-ts').SQLiteImportPayload = { db_name: 'restored', file: snapshot.data };
  const importOptions: import('nebula-sdk-ts').SQLiteImportOptions = { timeout: 75_000, signal: new AbortController().signal };
  const imported: import('nebula-sdk-ts').SQLiteImportResponse = await client.databases.importSQLite(importPayload, importOptions);
  const uploadedSize: number = imported.size_bytes;
  await client.databases.importSQLite({ db_name: 'browser_restore', file: new Blob([Uint8Array.from(snapshot.data)]) });
  await client.databases.importSQLite({ db_name: 'file_restore', file: new File([Uint8Array.from(snapshot.data)], 'upload.db') });
  // @ts-expect-error File contents are required; filesystem paths are not accepted.
  await client.databases.importSQLite({ db_name: 'restored', file: '/tmp/snapshot.db' });
  // @ts-expect-error Import cannot overwrite an existing database.
  await client.databases.importSQLite({ ...importPayload, overwrite: true });
  // @ts-expect-error The acknowledgement preserves the backend snake_case contract.
  const oldSize: number = imported.sizeBytes;
  void [uploadedSize, oldSize];
  void [dumpSQL, bytes, filename, bareSQL, parsedRows];
  void [label, total, oldPage, created, oldRow, row, oldId, primary, sqlitePrimary, oldKey, generated, signup, password, health];
}
void checkContracts;
`
  );
  execFileSync(
    process.execPath,
    [
      join(sdk, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2017',
      '--module',
      'CommonJS',
      '--moduleResolution',
      'node',
      '--lib',
      'ESNext,DOM',
      'consumer.ts',
    ],
    { cwd: temporary, stdio: 'inherit' }
  );
  console.log('Packed SDK passed file, CommonJS import, and TypeScript consumer checks.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
