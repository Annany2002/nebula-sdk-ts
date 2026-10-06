# Nebula TypeScript SDK

JavaScript/TypeScript client for the [Nebula backend](https://github.com/Annany2002/nebula-backend). It exposes authentication, database, schema, record, SQL, analytics, diagram, object, and export modules using native Fetch.

The [Nebula frontend](https://github.com/Annany2002/nebula-frontend) provides the web interface for database and account management.

## Installation

```bash
npm install nebula-sdk-ts
```

Requires Node.js 24 or later, or an environment with Fetch and AbortController. TypeScript declarations are included.

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

The contracts below apply to SDK 0.3.0 and later. Version 0.2.0 has the older declarations; see the migration guide below. SQL execution is available in SDK 0.4.0 and later. Analytics, diagrams, objects, and exports are available in SDK 0.5.0 and later. The integration checks target backend revision `e714059ca8c5ac72848a902b5edab325ade2cc26`.

- `records.list()` returns `{ records, pagination }`, where pagination contains `total`, `limit`, and `offset`.
- `records.create()` and `records.update()` return `{ message, record_id }`. Fetch the row with `records.get()` when needed.
- Schema creation returns `{ message, db_name, table_name }`. `getSchema()` returns `{ schema: [{ name, type, pk }] }`.
- `listTables()` returns table metadata with `rowCount` and PRAGMA column fields (`cid`, `name`, `type`, `notnull`, `dflt_value`, `pk`). Its numeric `pk` differs from the boolean `pk` in `getSchema()`.
- `databases.getApiKey()` returns `{ key_prefix, created_at }`. Only `createApiKey()` returns the full key. Database listings expose an optional `apiKeyPrefix`.
- Signup returns `{ message, user_id }`; login and profile responses contain user metadata without a password.

The backend adds `id` and `created_at` when creating tables through the schema endpoints. Do not supply those columns. User-defined column types are TEXT, INTEGER, REAL, BLOB, BOOLEAN, DATETIME, and NUMERIC (case insensitive). Schema requests accept `columns` or the legacy `schema` alias; non-empty `columns` takes precedence. Existing tables are left unchanged.

Database details and schema alteration are available in the backend but do not have SDK methods yet.

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

This is a read-only inspection endpoint. There are no dedicated object creation, editing, or deletion methods. Use `client.sql.execute()` to create or drop indexes and triggers; those changes take effect immediately. Triggers execute through SQLite when their defined events occur. Tables, views, and SQLite automatic indexes (including indexes for `PRIMARY KEY` and `UNIQUE` constraints) are not included in this catalog. Results are ordered by target name and then object name.

The SDK preserves server metadata and uses existing error classes for database, authentication, rate-limit, and server failures. Requests are not retried automatically.

Accurate index uniqueness metadata requires backend revision `e714059ca8c5ac72848a902b5edab325ade2cc26` or later. Older servers can report ordinary indexes as unique when `UNIQUE` appears in a name or SQL comment. The SDK does not reinterpret that flag.

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

Database, authentication, rate-limit, server, and network failures use the existing SDK error classes. Invalid snapshot headers throw `NetworkError`. Requests are not retried automatically and a rejected JWT does not fall back to an API key. These methods download on demand; Nebula does not offer scheduled backups or a server-side restore/upload endpoint.

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

| Module      | Methods                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `auth`      | `signup`, `login`, `healthP`, `getMe`, `updateProfile`, `findUser`      |
| `databases` | `create`, `list`, `delete`, `createApiKey`, `getApiKey`, `deleteApiKey` |
| `schema`    | `define`, `createTable`, `listTables`, `getSchema`, `deleteTable`       |
| `records`   | `create`, `list`, `get`, `update`, `delete`                             |
| `sql`       | `execute`                                                               |
| `analytics` | `get`                                                                   |
| `diagrams`  | `get`                                                                   |
| `exports`   | `sql`, `sqlite`                                                         |
| `objects`   | `get`                                                                   |

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

`npm run test:backend` requires Go, a C compiler, and Python 3 with its standard `sqlite3` module for export restore checks. It uses the sibling `../nebula-backend` repository by default; set `NEBULA_BACKEND_DIR` to another local checkout if needed. The runner builds that checkout, starts a temporary server with temporary SQLite storage, runs the authentication, contract, SQL, analytics, diagram, object, and export integration suites on separate servers, and removes its data afterward. The integration suites are skipped during ordinary `npm test` runs.

### Pull request checks

CI runs only when a pull request to `main` is opened. Updating or reopening an existing pull request does not trigger another run. All Node.js checks use Node.js 24 LTS. CI checks types and formatting, runs ESLint and the unit test suite once, validates the built npm package with JavaScript and TypeScript consumers, and runs integration tests against a pinned backend revision. The backend revision is recorded in `.github/workflows/ci.yml` and should be updated with deliberate contract changes.

ESLint permits no more than six `no-explicit-any` warnings; exceeding that budget fails the check. Formatting ignores generated files and the npm lockfile. Integration tests use temporary data, require no production credentials, and do not contact the deployed server.

Configure the repository ruleset to require **PR checks** before merging. This aggregate check succeeds only when every CI group passes. Adding the workflow alone does not enforce merge protection.

## License

[MIT](LICENSE).
