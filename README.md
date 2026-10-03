# Nebula TypeScript SDK

JavaScript/TypeScript client for the [Nebula backend](https://github.com/Annany2002/nebula-backend). It exposes authentication, database, schema, and record modules using native Fetch.

For the web interface and screenshots, see [Nebula Studio](https://github.com/Annany2002/nebula-frontend#screenshots).

## Installation

```bash
npm install nebula-sdk-ts
```

Requires Node.js 18 or later, or an environment with Fetch and AbortController. TypeScript declarations are included.

## Quick start

Create a database and an API key in Studio first. Set `NEBULA_API_KEY` to the generated key and use the backend origin as `baseURL` (capital `URL`, without `/api/v1`).

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

| Option    | Purpose                           | Default        |
| --------- | --------------------------------- | -------------- |
| `baseURL` | Backend origin, without `/api/v1` | Required       |
| `apiKey`  | Database API key                  | Required       |
| `timeout` | Request timeout in milliseconds   | `30000`        |
| `fetch`   | Custom Fetch implementation       | Global `fetch` |

Use a backend URL for your own instance rather than a hardcoded demo tunnel hostname. Keep API keys out of source control. A key used in browser code is visible to the browser user.

## Backend compatibility

The current SDK source has several gaps with the current backend. These notes describe the checked-in implementation; an installed npm release may differ.

- **JWT account operations:** `setAuthToken()` stores a token, but the HTTP layer currently always sends `Authorization: ApiKey ...`. Setting a token therefore does not enable JWT-only profile, database lifecycle, or API key management calls. Use Studio or direct Bearer-authenticated requests for these operations until the SDK HTTP layer is updated.
- **Record listing:** the backend returns `{ records, pagination }`; `records.list()` still declares `RecordResponse[]` and returns the JSON response without normalization. The quick start uses an explicit type assertion for that response.
- **Schema creation:** the backend adds `id` and `created_at` automatically. Do not supply them. SDK `ColumnDefinition` exposes only `name` and `type`; it does not declare foreign-key options or the backend's schema alteration API.
- **API key metadata:** the backend's GET key endpoint returns a prefix and creation timestamp, not the full key. The SDK's `ApiKeyResponse` type still expects `api_key`.
- **Browser use:** the HTTP layer adds `X-Nebula-Secret`, while the current backend CORS allowlist does not include that header. Cross-origin browser requests need a compatibility fix or a custom Fetch adapter.

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

The listed methods exist in the SDK; JWT-only methods remain subject to the compatibility issue above. Signup requires `username`, `email`, and `password` and does not return a login token. Log in separately.

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

Exported error classes include `NebulaError`, `ApiError`, `AuthError`, `BadRequestError`, `ForbiddenError`, `NotFoundError`, `RateLimitError`, `ServerError`, `TimeoutError`, and `NetworkError`.

## Development

```bash
git clone https://github.com/Annany2002/nebula-sdk-ts.git
cd nebula-sdk-ts
npm install
```

| Command              | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `npm test`           | Run Jest tests                                 |
| `npm run test:watch` | Watch tests                                    |
| `npm run coverage`   | Generate coverage                              |
| `npm run lint`       | Run ESLint                                     |
| `npm run build`      | Compile JavaScript and declarations to `dist/` |
| `npm run format`     | Format source and tests                        |

## License

[MIT](LICENSE).
