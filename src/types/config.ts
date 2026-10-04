// src/types/config.ts

/** Configuration options for the Nebula Client */
export interface NebulaClientConfig {
  /** The base URL of your Nebula instance (e.g., http://localhost:8080) */
  baseURL: string;
  /** Optional database-scoped API key. Omit for signup/login and JWT-only clients. */
  apiKey?: string;
  /** Optional custom fetch implementation (for environments like older Node or specific testing) */
  fetch?: typeof fetch;
  /** Optional request timeout in milliseconds (default: 30000) */
  timeout?: number;
}
