# Nebula TypeScript SDK

JavaScript/TypeScript client for the [Nebula backend](https://github.com/Annany2002/nebula-backend). It exposes authentication, database, schema, and record modules using native Fetch.

The [Nebula frontend](https://github.com/Annany2002/nebula-frontend) provides the web interface for database and account management.

## Installation

```bash
npm install nebula-sdk-ts
```

Requires Node.js 18 or later, or an environment with Fetch and AbortController. TypeScript declarations are included.

## Quick start

For database-key access, create a database and an API key through the Nebula frontend first. Set `NEBULA_API_KEY` to the generated key and use the backend origin as `baseURL` (capital `URL`, without `/api/v1`).

```typescript
import { NebulaClient, RecordResponse } from 'nebula-sdk-ts';

interface RecordsPage {
  records: RecordResponse[];
  pagination: { total: number; limit: number; offset: number };
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

  // Current backend returns a page object; the SDK's declared return type
  // still describes an array. See the compatibility notes below.
  const page = (await client.records.list('myapp', 'customers', undefined, {
    limit: 25,
    offset: 0,
    sort: 'id',
    order: 'asc',
    fields: 'id,name,email',
  })) as unknown as RecordsPage;

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

The current SDK source has several gaps with the current backend. These notes describe the checked-in implementation; an installed npm release may differ.

- **Record listing:** the backend returns `{ records, pagination }`; `records.list()` still declares `RecordResponse[]` and returns the JSON response without normalization. The quick start uses an explicit type assertion for that response.
- **Schema creation:** the backend adds `id` and `created_at` automatically. Do not supply them. SDK `ColumnDefinition` exposes only `name` and `type`; it does not declare foreign-key options or the backend's schema alteration API.
- **API key metadata:** the backend's GET key endpoint returns a prefix and creation timestamp, not the full key. The SDK's `ApiKeyResponse` type still expects `api_key`.

SQL execution, analytics, diagrams, object inspection, and exports are available in the backend but do not have SDK modules yet.

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

// createTable() uses the alternative /tables endpoint with the same payload.
await client.schema.createTable('myapp', {
  table_name: 'notes',
  columns: [{ name: 'body', type: 'TEXT' }],
});

// Permanently drops the table and its records.
await client.schema.deleteTable('myapp', 'notes');
```

## Record operations

Record IDs accepted by the current SDK are positive integers.

```typescript
await client.records.create('myapp', 'customers', {
  name: 'Avery Chen',
  email: 'avery@example.com',
});

const customer = await client.records.get('myapp', 'customers', 1);

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

`limit` is 1–1000 (default 100), `offset` defaults to 0, and `order` is `asc` or `desc`. See the return-shape note above before consuming `result`.

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

`npm run test:backend` requires Go and a C compiler. It uses the sibling `../nebula-backend` repository by default; set `NEBULA_BACKEND_DIR` to another local checkout if needed. The runner builds that checkout, starts a temporary server with temporary SQLite storage, runs the authentication integration suite, and removes its data afterward. The integration suite is skipped during ordinary `npm test` runs.

### Pull request checks

CI runs only when a pull request to `main` is opened. Updating or reopening an existing pull request does not trigger another run. It checks types and formatting, runs ESLint, tests Node.js 18/20/22/24 compatibility, validates the built npm package with JavaScript and TypeScript consumers, and runs integration tests against a pinned backend revision. The backend revision is recorded in `.github/workflows/ci.yml` and should be updated with deliberate contract changes.

ESLint currently permits the six existing `no-explicit-any` warnings; additional warnings fail the check. Formatting ignores generated files and the npm lockfile. Integration tests use temporary data, require no production credentials, and do not contact the deployed server.

Configure the repository ruleset to require **PR checks** before merging. This aggregate check succeeds only when every CI group passes. Adding the workflow alone does not enforce merge protection.

## License

[MIT](LICENSE).
