// src/types/config.ts

/** Configuration options for the Nebula Client */
export interface NebulaClientConfig {
  /** The base URL of your Nebula instance (e.g., http://localhost:8080) */
  baseURL: string;
  /** An API Key associated with the application using the SDK */
  apiKey: string;
  /** Optional custom fetch implementation (for environments like older Node or specific testing) */
  fetch?: typeof fetch;
  /** Optional request timeout in milliseconds (default: 30000) */
  timeout?: number;
}
