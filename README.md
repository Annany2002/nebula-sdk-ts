# Nebula TypeScript SDK

A TypeScript SDK for interacting with the Nebula platform. This SDK provides a type-safe way to interact with Nebula's APIs and services.

## Features

- TypeScript support with full type definitions
- Modern async/await API
- Comprehensive error handling
- Built-in HTTP client
- Modular architecture

## Installation

```bash
npm install nebula-sdk-ts
```

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.4.5

## Usage

```typescript
import { NebulaClient } from 'nebula-sdk-ts';

// Initialize the client
const client = new NebulaClient({
  baseUrl: 'https://api-nebula-backend.duckdns.org',
  apiKey: 'your_api_key',
});

// Use the client to interact with Nebula services
```

### Database Operations

The SDK provides a comprehensive set of functions for managing databases:

```typescript
// Create a new database
const newDb = await client.database.create({ db_name: 'my_app_db' });

// List all databases
const allDbs = await client.database.list();

// Delete a database
await client.database.delete('my_app_db');
```

Each database operation returns detailed information about the database, including:

- Database ID
- User ID
- Database name
- File path
- Creation timestamp
- Number of tables
- API key

### Schema Operations

Manage database schemas with the following operations:

```typescript
// Create a new schema
const schema = await client.schema.create('my_app_db', {
  name: 'users',
  fields: [
    { name: 'id', type: 'INTEGER', primaryKey: true },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'email', type: 'TEXT', unique: true },
  ],
});

// List all schemas in a database
const schemas = await client.schema.list('my_app_db');

// Get schema details
const schemaDetails = await client.schema.get('my_app_db', 'users');

// Delete a schema
await client.schema.delete('my_app_db', 'users');
```

Schema operations support various field types and constraints:

- Field Types: INTEGER, TEXT, BOOLEAN, FLOAT, DATE, etc.
- Constraints: primaryKey, unique, nullable, default, etc.

### Record Operations

Perform CRUD operations on database records:

```typescript
// Create a new record
const newRecord = await client.record.create('my_app_db', 'users', {
  name: 'John Doe',
  email: 'john@example.com',
});

// Read records
// Get all records
const allRecords = await client.record.list('my_app_db', 'users');

// Get a specific record
const record = await client.record.get('my_app_db', 'users', recordId);

// Query records with filters
const filteredRecords = await client.record.query('my_app_db', 'users', {
  where: { email: 'john@example.com' },
  limit: 10,
  offset: 0,
});

// Update a record
const updatedRecord = await client.record.update('my_app_db', 'users', recordId, {
  name: 'John Smith',
});

// Delete a record
await client.record.delete('my_app_db', 'users', recordId);
```

Record operations support:

- Filtering and querying with complex conditions
- Pagination with limit and offset
- Sorting by any field
- Batch operations for multiple records
- Transaction support for atomic operations

## Development

### Setup

1. Clone the repository:

```bash
git clone https://github.com/Annany2002/nebula-sdk-ts.git
cd nebula-sdk-ts
```

2. Install dependencies:

```bash
npm install
```

### Available Scripts

- `npm run build` - Build the TypeScript code
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run coverage` - Generate test coverage report
- `npm run lint` - Run ESLint
- `npm run format` - Format code using Prettier

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please open an issue in the [GitHub repository](https://github.com/Annany2002/nebula-sdk-ts/issues).
