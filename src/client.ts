// src/client.ts
import { NebulaClientConfig } from "./types";
import { NebulaError } from "./errors";
// Import modules when they are created
// import { AuthModule } from './modules/auth';
// import { DatabaseModule } from './modules/database';
// import { SchemaModule } from './modules/schema';
// import { RecordModule } from './modules/record';

/**
 * Main client class for interacting with the Nebula BaaS API.
 */
export class NebulaClient {
  private config: Required<NebulaClientConfig>; // Store config with defaults applied
  private authToken: string | null = null; // Internal state for JWT

  // Resource Modules will be added here
  // public readonly auth: AuthModule;
  // public readonly databases: DatabaseModule;
  // public readonly schema: SchemaModule;
  // public readonly records: RecordModule;

  /**
   * Creates an instance of the NebulaClient.
   * @param config - Configuration options for the client. Requires `baseURL`.
   */
  constructor(config: NebulaClientConfig) {
    if (!config || !config.baseURL) {
      throw new NebulaError("NebulaClient requires baseURL in configuration.");
    }

    // Validate baseURL format
    try {
      new URL(config.baseURL);
    } catch (e) {
      throw new NebulaError(`Invalid baseURL provided: ${config.baseURL}`);
    }

    // Apply defaults (only timeout for now)
    this.config = {
      fetch: fetch, // Default to global fetch
      timeout: 30000, // Default timeout
      ...config, // User config overrides defaults
    };

    // Initialize API modules (passing necessary context like config and token management)
    // This structure might change slightly depending on how modules access config/token
    // const context = { config: this.config, getAuthToken: () => this.authToken };
    // this.auth = new AuthModule(context);
    // this.databases = new DatabaseModule(context);
    // ...etc
  }

  /**
   * Sets the JWT authentication token to be used for subsequent API calls.
   * Pass `null` to clear the token.
   * @param token - The JWT token string or null.
   */
  public setAuthToken(token: string | null): void {
    this.authToken = token;
    // Potentially notify modules if they hold separate state? (Usually not needed)
  }

  /**
   * Gets the currently stored authentication token.
   * @returns The JWT token string or null.
   */
  public getAuthToken(): string | null {
    return this.authToken;
  }

  /**
   * Allows checking the current configuration (excluding sensitive info if necessary).
   * Useful for debugging.
   */
  public getConfig(): Omit<Required<NebulaClientConfig>, "fetch"> {
    // Exclude fetch function from display/return if desired
    const { fetch, ...rest } = this.config;
    return rest;
  }

  /**
   * Internal method to get the required configuration.
   * @internal
   */
  public _getConfig(): Required<NebulaClientConfig> {
    return this.config;
  }

  /**
   * Internal method to get the current auth token.
   * @internal
   */
  public _getAuthToken(): string | null {
    return this.authToken;
  }
}
