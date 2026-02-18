# Nebula TypeScript SDK

A TypeScript SDK for interacting with the [Nebula](https://github.com/Annany2002/nebula-backend) backend platform. Provides a type-safe, modular client for managing databases, schemas, records, authentication, and API keys.

## Installation

```bash
npm install nebula-sdk-ts
```

**Requirements:** Node.js >= 18.0.0 | TypeScript >= 5.4.5

## Quick Start

```typescript
import { NebulaClient } from 'nebula-sdk-ts';

const client = new NebulaClient({
  baseURL: 'https://api-nebula-backend.duckdns.org',
  apiKey: 'your_api_key',
});
```

## Authentication

```typescript
// Sign up
const signupRes = await client.auth.signup({
  username: 'johndoe',
  email: 'john@example.com',
  password: 'securePassword123',
});

// Log in
const loginRes = await client.auth.login({
  email: 'john@example.com',
  password: 'securePassword123',
});
client.setAuthToken(loginRes.token);

// Get current user profile
const me = await client.auth.getMe();

// Update profile
const updated = await client.auth.updateProfile({ username: 'newname' });

// Find a user by ID
const user = await client.auth.findUser('user-id-here');
```

## Database Operations

```typescript
// Create a database
const db = await client.databases.create({ db_name: 'my_app_db' });

// List all databases
const allDbs = await client.databases.list();

// Delete a database
await client.databases.delete('my_app_db');
```

## Schema Operations

```typescript
// Define a table schema
const schema = await client.schema.define('my_app_db', {
  table_name: 'users',
  columns: [
    { name: 'id', type: 'INTEGER', primary_key: true },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'email', type: 'TEXT', unique: true },
  ],
});

// Create a table (alternative endpoint)
const table = await client.schema.createTable('my_app_db', {
  table_name: 'posts',
  columns: [
    { name: 'id', type: 'INTEGER', primary_key: true },
    { name: 'title', type: 'TEXT' },
  ],
});

// List all tables
const tables = await client.schema.listTables('my_app_db');

// Get a specific table's schema
const tableSchema = await client.schema.getSchema('my_app_db', 'users');

// Delete a table
await client.schema.deleteTable('my_app_db', 'users');
```

## Record Operations

```typescript
// Create a record
const record = await client.records.create('my_app_db', 'users', {
  name: 'John Doe',
  email: 'john@example.com',
});

// List all records
const allRecords = await client.records.list('my_app_db', 'users');

// List with filters
const filtered = await client.records.list('my_app_db', 'users', {
  name: 'John Doe',
});

// List with pagination, sorting, and field selection
const paginated = await client.records.list('my_app_db', 'users', undefined, {
  limit: 10,
  offset: 0,
  sort: 'name',
  order: 'asc',
  fields: 'id,name,email',
});

// Get a single record by ID
const single = await client.records.get('my_app_db', 'users', 'record-id');

// Update a record
const updated = await client.records.update('my_app_db', 'users', 'record-id', {
  name: 'Jane Doe',
});

// Delete a record
await client.records.delete('my_app_db', 'users', 'record-id');
```

## API Key Management

```typescript
// Create an API key for a database
const key = await client.databases.createApiKey('my_app_db');

// Retrieve the existing API key
const existing = await client.databases.getApiKey('my_app_db');

// Delete an API key
await client.databases.deleteApiKey('my_app_db');
```

## Error Handling

The SDK throws typed errors for different failure scenarios:

```typescript
import { AuthError, NotFoundError, BadRequestError } from 'nebula-sdk-ts';

try {
  await client.databases.create({ db_name: 'my_db' });
} catch (error) {
  if (error instanceof AuthError) {
    // 401 - Invalid or missing credentials
  } else if (error instanceof BadRequestError) {
    // 400 - Invalid request payload
  } else if (error instanceof NotFoundError) {
    // 404 - Resource not found
  }
}
```

**Available error classes:** `AuthError`, `BadRequestError`, `ForbiddenError`, `NotFoundError`, `RateLimitError`, `ServerError`, `TimeoutError`, `NetworkError`

## Development

```bash
git clone https://github.com/Annany2002/nebula-sdk-ts.git
cd nebula-sdk-ts
npm install
```

| Script | Description |
|--------|-------------|
| `npm run build` | Build TypeScript to `dist/` |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run coverage` | Generate coverage report |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |

## License

MIT -- see [LICENSE](LICENSE) for details.
