# Nebula TypeScript SDK

JavaScript/TypeScript client for the [Nebula backend](https://github.com/Annany2002/nebula-backend). It exposes authentication, database, schema, record, SQL, analytics, diagram, object, and export modules using native Fetch.

The [Nebula frontend](https://github.com/Annany2002/nebula-frontend) provides the web interface for database and account management.

## Installation

```bash
npm install nebula-sdk-ts
```

Requires Node.js 24 or later, or an environment with Fetch and AbortController. SQLite import also requires native Blob and FormData support. TypeScript declarations are included.

## Quick start

For database-key access, create a database and an API key through the Nebula frontend first. Set `NEBULA_API_KEY` to the generated key and use the backend origin as `baseURL` (capital `URL`, without `/api/v1`).

```typescript
import { NebulaClient } from 'nebula-sdk-ts';

interface CustomerSummary {
  id: number;
  name: string;
  email: string;
}

async function main() {
  const apiKey = process.env.NEBULA_API_KEY;
  if (!apiKey) throw new Error('Set NEBULA_API_KEY before running this example.');

  const client = new NebulaClient({
    baseURL: process.env.NEBULA_BASE_URL || 'http://localhost:8080',
    apiKey,
    timeout: 30_000,
  });

  const tables = await client.schema.listTables('myapp');
  console.log(tables.tables);

  const page = await client.records.list<CustomerSummary>('myapp', 'customers', undefined, {
    limit: 25,
    offset: 0,
    sort: 'id',
    order: 'asc',
    fields: 'id,name,email',
  });

  console.log(page.records, page.pagination.total);
}

void main();
```

## Configuration

| Option    | Purpose                           | Default                   |
| --------- | --------------------------------- | ------------------------- |
| `baseURL` | Backend origin, without `/api/v1` | Required                  |
| `apiKey`  | Database API key                  | Optional for JWT sessions |
| `timeout` | Request timeout in milliseconds   | `30000`                   |
| `fetch`   | Custom Fetch implementation       | Global `fetch`            |

Use a backend URL for your own instance rather than a hardcoded demo tunnel hostname. Keep API keys out of source control. A key used in browser code is visible to the browser user.

## Authentication

An API key is optional when creating a client for signup, login, and account management:

```typescript
import { NebulaClient } from 'nebula-sdk-ts';

async function connectAccount() {
  const password = process.env.NEBULA_PASSWORD;
  if (!password) throw new Error('Set NEBULA_PASSWORD before connecting.');
  const client = new NebulaClient({ baseURL: 'http://localhost:8080' });
  const login = await client.auth.login({
    email: 'builder@example.com',
    password,
  });
  client.setAuthToken(login.token);
  const profile = await client.auth.getMe();
  return { client, profile };
}
```

Signup and login send no Authorization header. Account/profile, database creation/listing/deletion, and API key management require a JWT; the SDK rejects a missing JWT before making the request.

For data operations, a configured JWT takes precedence over the database API key. Call `client.setAuthToken(null)` to clear the session and use the configured database key again. Login returns a token; it does not set the session automatically. A rejected JWT is not retried with an API key.

The client sends only standard API headers. Request timeouts cover receiving headers and reading the response body. Network failures preserve their cause, HTTP errors preserve status codes, and `409 Conflict` responses throw `ConflictError`. Requests are not retried automatically, including writes.

## Backend compatibility

The contracts below apply to SDK 0.3.0 and later. Version 0.2.0 has the older declarations; see the migration guide below. SQL execution is available in SDK 0.4.0 and later. Analytics, diagrams, objects, and exports are available in SDK 0.5.0 and later. The integration checks target backend revision `a21cd7d3ba5670b475cb2a7ac9443fca20c64a59`. Native trigger management is available in SDK 0.8.0 and later.

- `records.list()` returns `{ records, pagination }`, where pagination contains `total`, `limit`, and `offset`.
- `records.create()` and `records.update()` return `{ message, record_id }`. Fetch the row with `records.get()` when needed.
- Schema creation returns `{ message, db_name, table_name }`. `getSchema()` returns `{ schema: [{ name, type, pk }] }`.
- `listTables()` returns table metadata with `rowCount` and PRAGMA column fields (`cid`, `name`, `type`, `notnull`, `dflt_value`, `pk`). Its numeric `pk` differs from the boolean `pk` in `getSchema()`.
- `databases.getApiKey()` returns `{ key_prefix, created_at }`. Only `createApiKey()` returns the full key. Database listings expose an optional `apiKeyPrefix`.
- Signup returns `{ message, user_id }`; login and profile responses contain user metadata without a password.

The backend adds `id` and `created_at` when creating tables through the schema endpoints. Do not supply those columns. User-defined column types are TEXT, INTEGER, REAL, BLOB, BOOLEAN, DATETIME, and NUMERIC (case insensitive). Schema requests accept `columns` or the legacy `schema` alias; non-empty `columns` takes precedence. Existing tables are left unchanged.

Database details and schema alteration are available in SDK 0.6.0 and later.

## Database details

`databases.get()` is available in SDK 0.6.0 and later.

```typescript
const { database } = await client.databases.get('myapp');
console.log(database.dbName, database.tables, database.totalRecords);
console.log(database.sizeBytes, database.sizeDisplay, database.apiKeyPrefix);
```

Use the owner's JWT or an API key scoped to that database. `DatabaseDetailsResponse` contains `database: DatabaseDetails`, with the database/owner IDs, name, server file path, creation timestamp, table count, total record count, size in bytes, formatted size, and optional API-key prefix. The full API key is not returned. `filePath` is server metadata, not a download URL; use the exports module for downloads.

Accurate totals for quoted table names require backend revision `4e86a8d072df4d842747d0a19211bf0c29ccc3d5` or later.

Counts exclude SQLite and Nebula internal tables and views. `sizeBytes` measures the main database file rather than WAL/SHM files or a quota; values are sampled on each request. The backend reports counts and sizes on a best-effort basis when storage reads fail. Creation, listing, deletion, and key management remain JWT-only operations.

## Schema operations

For a database that already exists, use its scoped API key:

```typescript
await client.schema.define('myapp', {
  table_name: 'customers',
  columns: [
    { name: 'name', type: 'TEXT' },
    { name: 'email', type: 'TEXT' },
  ],
});

const tables = await client.schema.listTables('myapp');
const schema = await client.schema.getSchema('myapp', 'customers');
console.log(schema.schema);

// createTable() uses the alternative /tables endpoint with the same payload.
await client.schema.createTable('myapp', {
  table_name: 'notes',
  columns: [{ name: 'body', type: 'TEXT' }],
});

// Permanently drops the table and its records.
await client.schema.deleteTable('myapp', 'notes');
```

Column and table-level foreign keys use the backend's field names:

```typescript
await client.schema.createTable('myapp', {
  table_name: 'orders',
  columns: [
    {
      name: 'customer_id',
      type: 'INTEGER',
      foreign_key: {
        target_table: 'customers',
        target_column: 'id',
        on_delete: 'CASCADE',
      },
    },
  ],
});
```

Use `foreign_keys` for table-level constraints with `column`, `target_table`, `target_column`, and optional `on_delete`/`on_update`. Supported actions are `CASCADE`, `SET NULL`, `SET DEFAULT`, `RESTRICT`, and `NO ACTION`. The simplified `getSchema()` reader may include constraint entries; use the column metadata from `listTables()` for reliable column inspection.

## Schema alteration

`schema.alterTable()` is available in SDK 0.6.0 and later. Use a single `AlterTableOperation` or an ordered batch of operations. Both an owner JWT and a database-scoped API key are accepted.

```typescript
const result = await client.schema.alterTable('myapp', 'customers', {
  operations: [
    {
      action: 'add_column',
      column: { name: 'role', type: 'TEXT', default_value: "'member'", not_null: true },
    },
    { action: 'rename_column', old_name: 'name', new_name: 'full_name' },
    { action: 'rename_table', new_table_name: 'members' },
  ],
});
console.log(result.table_name, result.statements);

// A single operation is also accepted; dropping a column removes its data.
await client.schema.alterTable('myapp', 'members', {
  action: 'drop_column',
  column_name: 'role',
});
```

The four actions are `add_column`, `drop_column`, `rename_column`, and `rename_table`. Batches run in order in one server transaction; later operations use the renamed table, and an execution failure rolls back the batch. The response contains `message`, `db_name`, the final `table_name`, generated SQL `statements`, and simplified `schema` metadata. `schema` can be `null` if metadata inspection fails after the transaction has committed; that does not mean the alteration failed. Use `listTables()` for PRAGMA column metadata.

Added columns use `AlterColumnDefinition`, including optional `foreign_key`, `not_null`, and `default_value`. Defaults are SQLite expression strings: use `'0'` for a number and `"'member'"` for a text literal. A `null` or empty default is omitted. Required columns need a non-empty default, and SQLite applies its own restrictions to added columns and foreign keys. The server prevents alterations to the reserved `id` and `created_at` columns.

Take an export before destructive changes. Column type changes are not supported by this endpoint. Validation failures preserve `BadRequestError`; SQLite execution failures currently return `ServerError`. Writes are never retried automatically.

## Record operations

Record routes use the table's actual single primary key, which can have a custom name. IDs accept non-empty strings or finite numbers, including zero, negative values, and real-valued keys. Pass integer IDs outside JavaScript's safe range as strings to avoid rounding in the request path; JSON numeric values returned by the server still have JavaScript's precision limits. Composite keys and tables without a primary key are rejected by the backend.

```typescript
const created = await client.records.create('myapp', 'customers', {
  name: 'Avery Chen',
  email: 'avery@example.com',
});

const customer = await client.records.get('myapp', 'customers', created.record_id);

await client.records.update('myapp', 'customers', 1, {
  name: 'Avery Rivera',
});

await client.records.delete('myapp', 'customers', 1);
```

Pass equality filters as the third argument and listing options as the fourth:

```typescript
const result = await client.records.list(
  'myapp',
  'customers',
  { name: 'Avery Chen' },
  { limit: 10, offset: 0, sort: 'name', order: 'asc', fields: 'id,name,email' }
);
```

`limit` is 1–1000 (default 100), `offset` defaults to 0, and `order` is `asc` or `desc`. Consume `result.records` and `result.pagination`.

Optional generics describe rows for your application; they do not validate JSON at runtime. When selecting fields, declare the selected shape rather than the full table row. Without a generic, column values are `unknown` and no `id` field is assumed.

## SQL execution

The SQL module is available in SDK 0.4.0 and later.

```typescript
const result = await client.sql.execute<[number, string]>(
  'myapp',
  'SELECT id, name FROM customers ORDER BY id LIMIT 10'
);

console.log(result.columns, result.rowCount, result.executionMs);
for (const [id, name] of result.rows ?? []) {
  console.log(id, name);
}

const statement = await client.sql.execute(
  'myapp',
  "UPDATE customers SET name = 'Avery Rivera' WHERE id = 1"
);
console.log(statement.rowsAffected);
```

Use a JWT session or an API key scoped to the selected database. The endpoint accepts SQL text without bound parameters. Add `LIMIT` in the SQL when limiting result size.

`SQLQueryResult` preserves the server response: optional `columns` and `rows`, required `rowCount`, `rowsAffected`, and `executionMs`, and an optional `message`. Rows are arrays in column order. Empty query results and write responses can omit `rows`; statements can also omit `columns`. Tuple generics describe expected values without runtime validation; cells default to `unknown`.

The server classifies SQL beginning with `SELECT`, `PRAGMA`, `EXPLAIN`, or `WITH` as a query. Other statements use the execution path. The SDK sends SQL unchanged and does not infer or normalize results. SQL failures map to `BadRequestError`; database and authentication errors use the existing SDK error classes. Requests are not retried automatically.

SQL writes take effect immediately. Tenant SQL restrictions, including the prohibition on `ATTACH` and `DETACH`, apply equally to SDK calls.

## Analytics

The analytics module is available in SDK 0.5.0 and later.

```typescript
const report = await client.analytics.get('myapp');
console.log(report.totalRequests, report.successRate, report.timeframe);

for (const service of report.services) {
  console.log(service.name, service.requests, service.warnings, service.errors);
  for (const bucket of service.history) {
    console.log(bucket.timestamp, bucket.requests);
  }
}

for (const finding of report.advisor) {
  console.log(finding.severity, finding.title, finding.tableName, finding.suggestion);
}
```

Use the database owner's JWT or an API key scoped to that database. `DatabaseAnalytics` includes `ServiceMetrics[]` and `AdvisorIssue[]`; each service contains `ServiceMetricBucket[]` history. A finding's `tableName` is optional. The SDK preserves the response without recomputing counts, percentages, or findings.

The server uses a fixed previous-24-hour window (`timeframe: '24h'`), with no timeframe or pagination parameters. `successRate` is a percentage from 0 to 100 and is 100 when no requests have been recorded. Service warnings count HTTP 4xx responses; errors count HTTP 5xx responses. Service history contains hour labels such as `14:00`, rather than full timestamps, and the backend returns at most 12 populated buckets per service.

Telemetry is recorded asynchronously, so a recently completed request may not appear immediately. Reading analytics does not add traffic to the report. Schema advisor findings describe the current schema and are not a complete security audit.

Database, authentication, rate-limit, and server failures use the existing SDK error classes. Requests are not retried automatically.

## Schema diagrams

The diagram module is available in SDK 0.5.0 and later.

```typescript
const diagram = await client.diagrams.get('myapp');
console.log(diagram.totalTables, diagram.totalForeignKeys);

for (const table of diagram.tables) {
  console.log(table.name, table.rowCount, table.sql);
  for (const column of table.columns) {
    console.log(column.cid, column.name, column.type, column.pk, column.dflt_value);
  }
  for (const foreignKey of table.foreignKeys) {
    console.log(table.name, foreignKey.from, foreignKey.table, foreignKey.to);
  }
}
```

Use the database owner's JWT or an API key scoped to that database. `SchemaDiagram` contains `TableDiagramInfo[]`, `totalTables`, and `totalForeignKeys`. Each table includes its name, `TableColumnInfo[]`, `ForeignKeyInfo[]`, current row count, and original creation SQL. Empty databases return `tables: []` with both totals set to zero. The backend orders tables by name and excludes views, SQLite internal tables, and Nebula metadata tables.

Column IDs (`cid`) are strings. `notnull` and `pk` are numeric SQLite metadata; composite primary keys can have `pk` values greater than one. Defaults (`dflt_value`) are SQL expression strings or `null`, rather than parsed JavaScript values.

Foreign-key metadata uses `table` for the referenced table, `from` for the source column, `to` for the referenced column, and camelCase `onUpdate`/`onDelete` actions. These read fields differ from the snake_case fields in schema creation payloads. Composite foreign keys share an `id` within their source table and have separate `seq` values for each column pair. `totalForeignKeys` counts reported column pairs, rather than distinct constraints.

The endpoint returns schema metadata without an image or saved canvas layout. The SDK preserves the response without inferring relationships or generating graph positions. Database, authentication, rate-limit, and server failures use the existing SDK error classes; requests are not retried automatically.

## Database objects

The objects module is available in SDK 0.5.0 and later.

```typescript
const objects = await client.objects.get('myapp');

for (const index of objects.indexes) {
  console.log(index.name, index.tableName, index.unique, index.sql);
}
for (const trigger of objects.triggers) {
  console.log(trigger.name, trigger.tableName, trigger.sql);
}
```

Use the database owner's JWT or an API key scoped to that database. `DatabaseObjects` contains `IndexInfo[]` and `TriggerInfo[]`. Empty collections are arrays. Indexes include their name, table name, uniqueness flag, and original creation SQL. Triggers include their name, target table or view name, and original creation SQL.

The catalog endpoint is read-only. Native column-index creation and deletion are available in SDK 0.7.0 and later (see below). Use `client.sql.execute()` for expression or partial indexes. Native trigger management is available in SDK 0.8.0 and later (see below); view-trigger creation continues to use SQL. Schema changes take effect immediately. Triggers execute through SQLite when their defined events occur. Tables, views, and SQLite automatic indexes (including indexes for `PRIMARY KEY` and `UNIQUE` constraints) are not included in this catalog. Results are ordered by target name and then object name.

The SDK preserves server metadata and uses existing error classes for database, authentication, rate-limit, and server failures. Requests are not retried automatically.

Accurate index uniqueness metadata requires backend revision `e714059ca8c5ac72848a902b5edab325ade2cc26` or later. Older servers can report ordinary indexes as unique when `UNIQUE` appears in a name or SQL comment. The SDK does not reinterpret that flag.

### Create and drop indexes

Native index management is available in SDK 0.7.0 and later and requires backend revision `3b7115917fc5876c1ee0e9add7a5cb902eadf142` or later.

```typescript
const createdIndex = await client.objects.createIndex('myapp', {
  name: 'idx_users_email',
  table_name: 'users',
  columns: ['email'],
  unique: true,
});
console.log(createdIndex.index.name, createdIndex.index.sql);

const droppedIndex = await client.objects.dropIndex('myapp', createdIndex.index.name);
console.log(droppedIndex.index_name);
```

`CreateIndexPayload` accepts an index name, an existing ordinary table, one to 64 existing column names in composite index order, and optional `unique` (default false). Names use one to 64 ASCII letters, digits, or underscores; `sqlite_` and `_nebula_` prefixes are reserved. Existing quoted table/column names are preserved. Expressions, partial predicates, descending order, and collations remain SQL operations.

`createIndex()` returns `CreateIndexResponse` with `message`, `db_name`, and an `IndexInfo`. A duplicate schema-object name or existing data that violates uniqueness produces `ConflictError` (409); the server transaction leaves the database unchanged.

`dropIndex()` returns `DropIndexResponse` with `message`, `db_name`, and the canonical `index_name`. Legacy quoted custom-index names are accepted. Table records remain intact; dropping a unique index removes the constraint it enforces. Automatic indexes, internal tables, virtual tables, and their shadow tables are protected (`BadRequestError`); a missing or previously dropped index produces `NotFoundError`.

Both methods accept owner JWTs or database-scoped API keys and use the existing error classes. Writes are not retried automatically. If a response is lost, refresh the catalog before repeating a mutation; no idempotency key is provided.

### Create and drop triggers

Native trigger management is available in SDK 0.8.0 and later and requires backend revision `264e53b2e72f4a4718f8a50d418ec14c525216f3` or later. CI integration tests pin the newer SQLite import revision listed above.

```typescript
const createdTrigger = await client.objects.createTrigger('myapp', {
  name: 'audit_email_changes',
  table_name: 'users',
  event: 'UPDATE',
  timing: 'AFTER',
  update_of: ['email'],
  when: 'NEW.email IS NOT OLD.email',
  body: 'INSERT INTO email_audit (user_id, old_email, new_email) VALUES (NEW.id, OLD.email, NEW.email);',
});
console.log(
  createdTrigger.trigger.name,
  createdTrigger.trigger.tableName,
  createdTrigger.trigger.sql
);

const droppedTrigger = await client.objects.dropTrigger('myapp', createdTrigger.trigger.name);
console.log(droppedTrigger.trigger_name);
```

The example assumes `users` and `email_audit` already exist. `CreateTriggerPayload` requires `name`, `table_name`, `event` (`INSERT`, `UPDATE`, or `DELETE`), and `body`. Optional `timing` is `BEFORE` or `AFTER` (default `AFTER`). `update_of` selects up to 64 distinct existing writable columns and applies only to `UPDATE`; omitted or empty means any column. An optional `when` SQL condition controls whether the trigger runs. Use SQLite's event-appropriate `NEW` and `OLD` references.

Names use one to 64 ASCII letters, digits, or underscores; `sqlite_` and `_nebula_` prefixes are reserved. Native creation supports ordinary user tables, including quoted table/column names. View triggers (`INSTEAD OF`) still use `client.sql.execute()`.

`body` contains semicolon-terminated SQL statements inside the trigger. Omit the `CREATE TRIGGER`, `BEGIN`, and final `END` wrapper. SQL text is preserved. The body is limited to 64 KiB and the condition to 8 KiB of UTF-8 text, without NUL; the server also limits the complete JSON request to 128 KiB, including escaping. The SDK validates input shapes, event/timing choices, and SQL text byte limits before fetching. The server validates names, targets, columns, SQL, and references transactionally, without executing actions during creation. Runtime data errors, recursion, and later schema changes can still make a trigger fail when it runs.

`createTrigger()` returns `CreateTriggerResponse` with `message`, `db_name`, and canonical `TriggerInfo` metadata. Conflicting schema-object names produce `ConflictError`; missing tables produce `NotFoundError`; unsupported targets, invalid SQL/references, and protected objects produce `BadRequestError`. A failed creation leaves no partial definition.

`dropTrigger()` returns `DropTriggerResponse` with `message`, `db_name`, and the stored canonical `trigger_name`. Legacy quoted custom triggers on tables or views are supported. Protected targets remain unavailable. Deletion stops future trigger actions and preserves records and earlier effects. Missing or previously dropped triggers produce `NotFoundError`.

Both methods accept owner JWTs or database-scoped API keys and use existing SDK error classes. Writes are not retried. If a response is lost, refresh `client.objects.get()` before deciding whether to repeat the mutation; there is no idempotency key.

## Database exports

The exports module is available in SDK 0.5.0 and later.

```typescript
import { writeFile } from 'node:fs/promises';

const dump = await client.exports.sql('myapp');
await writeFile(dump.filename, dump.sql, 'utf8');

const snapshot = await client.exports.sqlite('myapp');
await writeFile(snapshot.filename, snapshot.data);
```

Use the database owner's JWT or a database-scoped API key for either format. `exports.sql()` returns `SQLExport` with the server's `sql` text and `filename`. The SQL dump includes table definitions, rows, indexes, views, and triggers; the server reads schema and data in one transaction. Empty databases still produce a transaction-wrapped SQL dump.

`exports.sqlite()` returns `SQLiteExport` with `data: Uint8Array` and a suggested `filename` of `<dbName>.db`. The server creates a consistent standalone SQLite snapshot, including committed WAL data. The SDK preserves the bytes and checks the 16-byte SQLite header; this does not replace an integrity check. The filename follows the backend naming convention without requiring access to `Content-Disposition`, which the server does not expose through CORS.

In a browser, pass `snapshot.data` to `new Blob([Uint8Array.from(snapshot.data)], { type: 'application/octet-stream' })` and use your application's download flow. The SDK does not write files or start downloads. Both exports are buffered in memory and must finish within the configured request timeout, including reading the response body. Set an appropriate timeout for your database size; streaming is not supported.

Database, authentication, rate-limit, server, and network failures use the existing SDK error classes. Invalid snapshot headers throw `NetworkError`. Requests are not retried automatically and a rejected JWT does not fall back to an API key. These methods download on demand; scheduled backups are not implemented.

## SQLite import

SQLite import is available in SDK 0.9.0 and later and requires backend revision `a21cd7d3ba5670b475cb2a7ac9443fca20c64a59` or later, which provides `POST /api/v1/databases/import/sqlite`.

```typescript
import { readFile } from 'node:fs/promises';

// Sign in and call client.setAuthToken(session.token) before importing.
const controller = new AbortController();
const imported = await client.databases.importSQLite(
  { db_name: 'restored_project', file: await readFile('myapp.db') },
  { timeout: 75_000, signal: controller.signal }
);
console.log(imported.db_name, imported.size_bytes);
```

`SQLiteImportPayload.file` accepts a browser `File`/`Blob`, a `Uint8Array`, or a Node `Buffer`. Pass `snapshot.data` from `client.exports.sqlite()` directly to import an exported snapshot. The SDK accepts file contents, not filesystem paths, and sends a fixed upload filename; filenames do not determine the destination.

Import requires the owner's JWT. An API-key-only client rejects the operation locally with `AuthError`; an invalid JWT never falls back to a configured API key. `db_name` must contain 1–64 ASCII letters, digits or underscores. Import creates a new database, without replacing an existing registration or file; conflicts throw `ConflictError`. Generate a database API key separately after import.

Snapshots are limited to **64 MiB**. The SDK checks the file size and 16-byte SQLite header before uploading; the server checks integrity, foreign keys and supported schema objects. Use a consistent standalone snapshot from SQLite's backup API or Nebula's export, rather than copying a live main file that may depend on a separate WAL. Ordinary tables, records, indexes, views, triggers, sequences, BLOBs and NULLs are preserved. SQL dumps, archives, encrypted files, virtual/shadow tables and reserved Nebula schema objects are not supported.

`SQLiteImportOptions.timeout` overrides the client timeout for this request only, including upload and response-body reading. Without it, the client timeout applies (30 seconds by default). The server allows up to 60 seconds overall; the example uses 75 seconds to allow for transport overhead. Native Fetch manages the multipart boundary; custom Fetch implementations must accept standard FormData. Inputs are buffered in memory; file streaming and upload-progress callbacks are not provided.

`SQLiteImportResponse` contains `message`, `db_name` and `size_bytes`. The SDK requires a complete matching acknowledgement with HTTP 201; an incomplete or unexpected success response throws `NetworkError`. HTTP failures retain the existing SDK error classes and status codes, including 408, 413, 415 and 503.

Call `controller.abort()` to cancel, which throws `RequestAbortedError` (a `NetworkError` subclass). Cancellation, timeouts, network failures and ambiguous responses do not prove that the server rolled back. Check `client.databases.list()` or `client.databases.get(dbName)` before retrying, and reuse the same destination name to avoid creating a second copy. Writes are never retried automatically. Import does not migrate platform users, credentials, keys or telemetry, or restore over an existing database.

## Migrating from 0.2.0

This change corrects declarations to match responses the backend already returns. Runtime response bodies remain unchanged.

| Previous declaration or assumption                | Current contract                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `records.list()` is an array                      | Read `page.records` and `page.pagination`; remove manual page casts         |
| Create/update return a full record                | Read `result.record_id`; call `records.get()` to retrieve the row           |
| Every row has `id: number`                        | Use a row generic or narrow unknown values; pass the actual primary key     |
| One `SchemaInfoResponse` for creation and reading | Creation uses `SchemaCreateResponse`; reads use `SchemaInfoResponse.schema` |
| Table columns are `ColumnDefinition[]`            | Reads use `TableColumnInfo[]` with SQLite metadata                          |
| GET API key returns `ApiKeyResponse.api_key`      | GET uses `ApiKeyMetadataResponse`; creation still uses `ApiKeyResponse`     |
| Signup returns optional `userId`                  | Read required `user_id`                                                     |
| User metadata includes a password                 | `User` and `UserInfo` contain only public profile fields                    |
| `auth.healthP()` resolves to void                 | Inspect `ProtectedHealthResponse` for the current authentication scheme     |

## Module surface

| Module      | Methods                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `auth`      | `signup`, `login`, `healthP`, `getMe`, `updateProfile`, `findUser`                             |
| `databases` | `create`, `importSQLite`, `list`, `get`, `delete`, `createApiKey`, `getApiKey`, `deleteApiKey` |
| `schema`    | `define`, `createTable`, `listTables`, `getSchema`, `deleteTable`, `alterTable`                |
| `records`   | `create`, `list`, `get`, `update`, `delete`                                                    |
| `sql`       | `execute`                                                                                      |
| `analytics` | `get`                                                                                          |
| `diagrams`  | `get`                                                                                          |
| `exports`   | `sql`, `sqlite`                                                                                |
| `objects`   | `get`, `createIndex`, `dropIndex`, `createTrigger`, `dropTrigger`                              |

Account/profile, database lifecycle, and API key management methods require a JWT set with `setAuthToken()`. Signup requires `username`, `email`, and `password` and does not return a login token. Log in separately.

## Error handling

```typescript
import { AuthError, BadRequestError, NotFoundError } from 'nebula-sdk-ts';

try {
  await client.records.get('myapp', 'customers', 1);
} catch (error) {
  if (error instanceof AuthError) {
    console.error('Invalid or missing credentials.');
  } else if (error instanceof BadRequestError) {
    console.error('Invalid request.');
  } else if (error instanceof NotFoundError) {
    console.error('Record, table, or database not found.');
  } else {
    throw error;
  }
}
```

Exported error classes include `NebulaError`, `ApiError`, `AuthError`, `BadRequestError`, `ConflictError`, `ForbiddenError`, `NotFoundError`, `RateLimitError`, `ServerError`, `TimeoutError`, and `NetworkError`.

## Development

```bash
git clone https://github.com/Annany2002/nebula-sdk-ts.git
cd nebula-sdk-ts
npm ci
```

| Command                | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`    | Check source and test types without emitting files                  |
| `npm run format:check` | Check repository formatting without changing files                  |
| `npm run test:backend` | Run against an isolated local Go backend and temporary SQLite files |
| `npm test`             | Run Jest tests                                                      |
| `npm run test:ci`      | Run Jest tests serially with coverage                               |
| `npm run test:package` | Build, pack, install, and validate the published package surface    |
| `npm run test:watch`   | Watch tests                                                         |
| `npm run coverage`     | Generate coverage                                                   |
| `npm run lint`         | Run ESLint                                                          |
| `npm run build`        | Compile JavaScript and declarations to `dist/`                      |
| `npm run format`       | Format source, tests, scripts, configuration, docs, and workflows   |

`npm run test:backend` requires Go, a C compiler, and Python 3 with its standard `sqlite3` module for export restore checks. It uses the sibling `../nebula-backend` repository by default; set `NEBULA_BACKEND_DIR` to another local checkout if needed. The runner builds that checkout, starts a temporary server with temporary SQLite storage, runs the authentication, contract, SQL, analytics, diagram, object, native index, native trigger, export, database detail, schema alteration, and SQLite import integration suites on separate servers, and removes its data afterward. The integration suites are skipped during ordinary `npm test` runs.

`npm run test:backend:imports` runs only the SQLite import suite. It verifies snapshot preservation, export/import round-trips, owner isolation, conflicts and validation failures. The default integration suite and CI also run these checks against the backend import revision pinned above.

### Pull request checks

CI runs only when a pull request to `main` is opened. Updating or reopening an existing pull request does not trigger another run. All Node.js checks use Node.js 24 LTS. CI checks types and formatting, runs ESLint and the unit test suite once, validates the built npm package with JavaScript and TypeScript consumers, and runs integration tests against a pinned backend revision. The backend revision is recorded in `.github/workflows/ci.yml` and should be updated with deliberate contract changes.

ESLint permits no more than six `no-explicit-any` warnings; exceeding that budget fails the check. Formatting ignores generated files and the npm lockfile. Integration tests use temporary data, require no production credentials, and do not contact the deployed server.

Configure the repository ruleset to require **PR checks** before merging. This aggregate check succeeds only when every CI group passes. Adding the workflow alone does not enforce merge protection.

## License

[MIT](LICENSE).
