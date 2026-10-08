// src/modules/database.ts
import { makeMultipartRequest, makeRequest, RequestContext } from '../http';
import {
  DbListResponse,
  DatabaseDetailsResponse,
  DbCreatePayload,
  DbInfoResponse,
  ApiKeyResponse,
  ApiKeyMetadataResponse,
  SQLiteImportPayload,
  SQLiteImportOptions,
  SQLiteImportResponse,
} from '../types';
import { ModuleContext } from './_common';
import { NebulaError, NetworkError, RequestAbortedError } from '../errors';

export class DatabaseModule {
  private context: ModuleContext;

  constructor(context: ModuleContext) {
    this.context = context;
  }

  private getRequestContext(): RequestContext {
    return {
      ...this.context.config,
      authentication: 'bearer',
      authToken: this.context.getAuthToken(), // Get current token for the request
    };
  }

  /**
   * Creates a new database registration.
   * Requires a valid token to be set on the client.
   * @param payload - Object containing the database name.
   * @returns Information about the created database.
   * @throws {BadRequestError} If the database name is invalid.
   * @throws {ConflictError} If the database name already exists.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async create(payload: DbCreatePayload): Promise<DbInfoResponse> {
    if (!payload || !payload.db_name) {
      throw new Error('Database name (db_name) is required.');
    }
    return makeRequest<DbInfoResponse>(
      'api/v1/databases',
      'POST',
      this.getRequestContext(),
      undefined,
      payload
    );
  }

  /**
   * Import a standalone SQLite snapshot into a new database using the owner's JWT.
   * Checks the size/header locally; the server validates integrity and schema support.
   * Never retries. After cancellation, timeout or an unconfirmed response, check list/get
   * before retrying: stopping the client does not confirm that the server rolled back.
   */
  async importSQLite(
    payload: SQLiteImportPayload,
    options: SQLiteImportOptions = {}
  ): Promise<SQLiteImportResponse> {
    if (
      !payload ||
      typeof payload.db_name !== 'string' ||
      !/^[a-zA-Z0-9_]{1,64}$/.test(payload.db_name)
    ) {
      throw new NebulaError(
        'Database name must contain 1–64 ASCII letters, digits or underscores.'
      );
    }
    if (!options || typeof options !== 'object')
      throw new NebulaError('Import options must be an object.');
    const { timeout, signal } = options;
    if (
      timeout !== undefined &&
      (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
    ) {
      throw new NebulaError('timeout must be an integer from 1 to 2147483647 milliseconds.');
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new NebulaError('signal must be an AbortSignal.');
    }
    if (signal?.aborted) {
      throw new RequestAbortedError(
        undefined,
        signal.reason instanceof Error ? signal.reason : undefined
      );
    }
    const dbName = payload.db_name;
    const file = await sqliteSnapshot(payload.file);
    const form = new FormData();
    form.append('db_name', dbName);
    // The server ignores upload filenames. A fixed short name also bounds framing overhead.
    form.append('file', file, 'snapshot.db');
    const result = await makeMultipartRequest<unknown>(
      'api/v1/databases/import/sqlite',
      {
        ...this.getRequestContext(),
        timeout: timeout ?? this.context.config.timeout,
        signal,
      },
      form,
      201
    );
    const response =
      result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : null;
    if (
      response?.db_name !== dbName ||
      response.size_bytes !== file.size ||
      typeof response.message !== 'string' ||
      !response.message.trim()
    ) {
      throw new NetworkError(
        'Received an incomplete SQLite import acknowledgement. Check the database list before retrying.'
      );
    }
    return { db_name: dbName, size_bytes: file.size, message: response.message };
  }

  /**
   * Lists the names of databases registered by the authenticated user.
   * Requires a valid token to be set on the client.
   * @returns An object containing a list of databases along with their metadata.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async list(): Promise<DbListResponse> {
    return makeRequest<DbListResponse>('api/v1/databases', 'GET', this.getRequestContext());
  }

  /** Inspect one database using its owner's JWT or a database-scoped API key. */
  async get(dbName: string): Promise<DatabaseDetailsResponse> {
    if (typeof dbName !== 'string' || !dbName.trim()) {
      throw new NebulaError('Database name is required.');
    }
    return makeRequest<DatabaseDetailsResponse>(
      `api/v1/databases/${encodeURIComponent(dbName)}`,
      'GET',
      { ...this.getRequestContext(), authentication: 'auto' }
    );
  }

  /**
   * Deletes a database registration and attempts to remove its data file.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database to delete.
   * @returns A promise that resolves when deletion is successful (API returns 204 No Content).
   * @throws {NotFoundError} If the database name does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async delete(dbName: string): Promise<void> {
    if (!dbName) {
      throw new Error('Database name is required for deletion.');
    }
    await makeRequest<null>(
      `api/v1/databases/${encodeURIComponent(dbName)}`,
      'DELETE',
      this.getRequestContext()
    );
  }

  // --- API Key Management ---

  /**
   * Retrieves API key metadata for a specific database.
   * Requires a valid JWT token (not API key auth).
   * @param dbName - The name of the database.
   * @returns The key prefix and creation timestamp, without the secret.
   * @throws {NotFoundError} If the database does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async getApiKey(dbName: string): Promise<ApiKeyMetadataResponse> {
    if (!dbName) throw new Error('Database name is required.');
    const path = `api/v1/account/databases/${encodeURIComponent(dbName)}/apikey`;
    return makeRequest<ApiKeyMetadataResponse>(path, 'GET', this.getRequestContext());
  }

  /**
   * Creates a new API key for a specific database.
   * Requires a valid JWT token (not API key auth).
   * @param dbName - The name of the database.
   * @returns The newly created API key (shown only once).
   * @throws {NotFoundError} If the database does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async createApiKey(dbName: string): Promise<ApiKeyResponse> {
    if (!dbName) throw new Error('Database name is required.');
    const path = `api/v1/account/databases/${encodeURIComponent(dbName)}/apikey`;
    return makeRequest<ApiKeyResponse>(path, 'POST', this.getRequestContext());
  }

  /**
   * Deletes the API key for a specific database.
   * Requires a valid JWT token (not API key auth).
   * @param dbName - The name of the database.
   * @returns A promise that resolves when deletion is successful.
   * @throws {NotFoundError} If the database or API key does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async deleteApiKey(dbName: string): Promise<void> {
    if (!dbName) throw new Error('Database name is required.');
    const path = `api/v1/account/databases/${encodeURIComponent(dbName)}/apikey`;
    await makeRequest<null>(path, 'DELETE', this.getRequestContext());
  }
}

async function sqliteSnapshot(input: Blob | Uint8Array): Promise<Blob> {
  if (typeof Blob === 'undefined' || typeof FormData === 'undefined') {
    throw new NebulaError('SQLite import requires native Blob and FormData support.');
  }
  if (!(input instanceof Blob) && !(input instanceof Uint8Array)) {
    throw new NebulaError('Snapshot must be a Blob, File or Uint8Array.');
  }
  const size = input instanceof Blob ? input.size : input.byteLength;
  if (size < 512 || size > 64 * 1024 * 1024) {
    throw new NebulaError('SQLite snapshots must be between 512 bytes and 64 MiB.');
  }
  const file = input instanceof Blob ? input : new Blob([Uint8Array.from(input)]);
  let header: Uint8Array;
  try {
    header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch (cause) {
    throw new NetworkError(
      'Could not read the SQLite snapshot header.',
      cause instanceof Error ? cause : new Error(String(cause))
    );
  }
  if (
    !Array.from('SQLite format 3\0').every(
      (character, index) => header[index] === character.charCodeAt(0)
    )
  ) {
    throw new NebulaError(
      'Invalid SQLite snapshot header. SQL dumps and archives are not supported.'
    );
  }
  return file;
}
