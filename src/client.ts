// src/client.ts
import { NebulaClientConfig } from './types';
import { NebulaError } from './errors';
import { AuthModule } from './modules/auth';
import { DatabaseModule } from './modules/database';
import { SchemaModule } from './modules/schema';
import { ModuleContext, ResolvedClientConfig } from './modules/_common';
import { DEFAULT_TIMEOUT } from './config';
import { RecordModule } from './modules/record';
import { SQLModule } from './modules/sql';
import { AnalyticsModule } from './modules/analytics';

/**
 * Main client class for interacting with the Nebula  API.
 */
export class NebulaClient {
  private config: ResolvedClientConfig;
  private authToken: string | null = null;

  // Resource Modules
  public readonly auth: AuthModule;
  public readonly databases: DatabaseModule;
  public readonly schema: SchemaModule;
  public readonly records: RecordModule;
  public readonly sql: SQLModule;
  public readonly analytics: AnalyticsModule;

  /**
   * Creates an instance of the NebulaClient.
   * @param config - Configuration options for the client. Requires an HTTP(S) `baseURL`. An API key is optional for JWT sessions.
   */
  constructor(config: NebulaClientConfig) {
    if (!config || typeof config.baseURL !== 'string' || !config.baseURL) {
      throw new NebulaError('NebulaClient requires baseURL in configuration.');
    }
    let baseURL: URL;
    try {
      baseURL = new URL(config.baseURL);
    } catch {
      throw new NebulaError('Invalid baseURL: provide an absolute HTTP(S) URL.');
    }
    if (
      !['http:', 'https:'].includes(baseURL.protocol) ||
      baseURL.username ||
      baseURL.password ||
      baseURL.search ||
      baseURL.hash
    ) {
      throw new NebulaError(
        'Invalid baseURL: use HTTP(S) without credentials, query, or fragment.'
      );
    }
    if (config.apiKey !== undefined) validateCredential(config.apiKey, 'apiKey');
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
      throw new NebulaError('timeout must be an integer from 1 to 2147483647 milliseconds.');
    }
    const fetchImplementation = config.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== 'function') {
      throw new NebulaError(
        'Fetch is unavailable. Provide a fetch implementation in configuration.'
      );
    }
    this.config = { ...config, fetch: fetchImplementation, timeout };

    // Create the context for modules
    const context: ModuleContext = {
      config: this.config,
      getAuthToken: () => this.authToken, // Provide a way for modules to get the token
    };

    // Initialize API modules
    this.auth = new AuthModule(context);
    this.databases = new DatabaseModule(context);
    this.schema = new SchemaModule(context);
    this.records = new RecordModule(context);
    this.sql = new SQLModule(context);
    this.analytics = new AnalyticsModule(context);
  }

  /**
   * Sets the JWT authentication token to be used for subsequent API calls.
   * Pass `null` to clear the token.
   * @param token - The JWT token string or null.
   */
  public setAuthToken(token: string | null): void {
    if (token !== null) validateCredential(token, 'authToken');
    this.authToken = token;
  }

  /**
   * Gets the currently stored authentication token.
   * @returns The JWT token string or null.
   */
  public getAuthToken(): string | null {
    return this.authToken;
  }

  /**
   * Returns configuration without the fetch function. Includes the API key, if configured;
   * do not log or expose this object to untrusted callers.
   */
  public getConfig(): Omit<ResolvedClientConfig, 'fetch'> {
    return {
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
    };
  }

  /**
   * Internal method to get the required configuration.
   * @internal
   */
  public _getConfig(): ResolvedClientConfig {
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

function validateCredential(value: string, name: string): void {
  if (typeof value !== 'string' || !value || /\s/.test(value)) {
    throw new NebulaError(`${name} must be a non-empty string without whitespace.`);
  }
}
