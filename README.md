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
  baseUrl: 'base_url',
  apiKey: 'your_api_key',
});

// Use the client to interact with Nebula services
```

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
