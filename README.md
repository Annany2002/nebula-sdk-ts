# Nebula TypeScript SDK

JavaScript/TypeScript client for the [Nebula backend](https://github.com/Annany2002/nebula-backend). It exposes authentication, database, schema, and record modules using native Fetch.

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

The contracts below apply to SDK 0.3.0. Version 0.2.0 has the older declarations; see the migration guide below. The integration checks target backend revision `4bb9912bdc37ec8c199db1298fd77f9dc3f598ba`.

- `records.list()` returns `{ records, pagination }`, where pagination contains `total`, `limit`, and `offset`.
- `records.create()` and `records.update()` return `{ message, record_id }`. Fetch the row with `records.get()` when needed.
- Schema creation returns `{ message, db_name, table_name }`. `getSchema()` returns `{ schema: [{ name, type, pk }] }`.
- `listTables()` returns table metadata with `rowCount` and PRAGMA column fields (`cid`, `name`, `type`, `notnull`, `dflt_value`, `pk`). Its numeric `pk` differs from the boolean `pk` in `getSchema()`.
- `databases.getApiKey()` returns `{ key_prefix, created_at }`. Only `createApiKey()` returns the full key. Database listings expose an optional `apiKeyPrefix`.
- Signup returns `{ message, user_id }`; login and profile responses contain user metadata without a password.

The backend adds `id` and `created_at` when creating tables through the schema endpoints. Do not supply those columns. User-defined column types are TEXT, INTEGER, REAL, BLOB, BOOLEAN, DATETIME, and NUMERIC (case insensitive). Schema requests accept `columns` or the legacy `schema` alias; non-empty `columns` takes precedence. Existing tables are left unchanged.

SQL execution, analytics, diagrams, object inspection, exports, database details, and schema alteration are available in the backend but do not have SDK methods yet.

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

`npm run test:backend` requires Go and a C compiler. It uses the sibling `../nebula-backend` repository by default; set `NEBULA_BACKEND_DIR` to another local checkout if needed. The runner builds that checkout, starts a temporary server with temporary SQLite storage, runs the authentication and contract integration suites on separate servers, and removes its data afterward. The integration suites are skipped during ordinary `npm test` runs.

### Pull request checks

CI runs only when a pull request to `main` is opened. Updating or reopening an existing pull request does not trigger another run. All Node.js checks use Node.js 24 LTS. CI checks types and formatting, runs ESLint and the unit test suite once, validates the built npm package with JavaScript and TypeScript consumers, and runs integration tests against a pinned backend revision. The backend revision is recorded in `.github/workflows/ci.yml` and should be updated with deliberate contract changes.

ESLint permits no more than six `no-explicit-any` warnings; exceeding that budget fails the check. Formatting ignores generated files and the npm lockfile. Integration tests use temporary data, require no production credentials, and do not contact the deployed server.

Configure the repository ruleset to require **PR checks** before merging. This aggregate check succeeds only when every CI group passes. Adding the workflow alone does not enforce merge protection.

## License

[MIT](LICENSE).
