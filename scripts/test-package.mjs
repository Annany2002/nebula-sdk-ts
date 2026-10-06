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
  for (const expected of ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE']) {
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
const { NebulaClient, ConflictError, ApiError } = require('nebula-sdk-ts');
const client = new NebulaClient({ baseURL: 'http://localhost:8080' });
assert.equal(typeof client.auth.login, 'function');
assert.equal(typeof client.records.list, 'function');
assert.equal(typeof client.sql.execute, 'function');
assert.equal(typeof client.analytics.get, 'function');
assert(new ConflictError('duplicate') instanceof ApiError);
`
  );
  execFileSync(process.execPath, ['consumer.cjs'], { cwd: temporary, stdio: 'inherit' });

  await writeFile(
    join(temporary, 'consumer.ts'),
    `import { NebulaClient, NebulaClientConfig, ConflictError, ApiError, RecordListResponse, RecordMutationResponse, SchemaCreateResponse, SchemaInfoResponse, TableListResponse, ApiKeyMetadataResponse, ApiKeyResponse, SignupResponse, User, ProtectedHealthResponse, SQLQueryResult, DatabaseAnalytics, ServiceMetrics, ServiceMetricBucket, AdvisorIssue } from 'nebula-sdk-ts';
const config: NebulaClientConfig = { baseURL: 'http://localhost:8080' };
const client: NebulaClient = new NebulaClient(config);
const error: ApiError = new ConflictError('duplicate');
void client;
void error;
interface Item { item_key: string; label: string }
async function checkContracts() {
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
