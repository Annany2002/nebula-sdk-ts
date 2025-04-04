// src/client.ts
import { NebulaClientConfig } from "./types";
import { NebulaError } from "./errors";
import { AuthModule } from "./modules/auth";
// Import modules when they are created
// import { DatabaseModule } from './modules/database';
// import { SchemaModule } from './modules/schema';
// import { RecordModule } from './modules/record';

/** Internal context passed to modules */
interface ModuleContext {
  config: Required<NebulaClientConfig>;
  getAuthToken: () => string | null;
}

/**
 * Main client class for interacting with the Nebula BaaS API.
 */
export class NebulaClient {
  private config: Required<NebulaClientConfig>;
  private authToken: string | null = null;

  // Resource Modules
  public readonly auth: AuthModule; // Publicly expose the auth module
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

    // Create the context for modules
    const context: ModuleContext = {
      config: this.config,
      getAuthToken: () => this.authToken, // Provide a way for modules to get the token
    };

    // Initialize API modules
    this.auth = new AuthModule(context);
    // this.databases = new DatabaseModule(context);
    // this.schema = new SchemaModule(context);
    // this.records = new RecordModule(context);
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
