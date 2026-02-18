// src/modules/database.ts
import { makeRequest } from '../http';
import { DbListResponse, DbCreatePayload, DbInfoResponse, ApiKeyResponse } from '../types';
import { ModuleContext } from './_common';

export class DatabaseModule {
  private context: ModuleContext;

  constructor(context: ModuleContext) {
    this.context = context;
  }

  private getRequestContext() {
    return {
      ...this.context.config,
      authToken: this.context.getAuthToken(), // Get current token for the request
    };
  }

  /**
   * Creates a new database registration.
   * Requires a valid token to be set on the client.
   * @param payload - Object containing the database name.
   * @returns Information about the created database.
   * @throws {BadRequestError} If the database name already exists or is invalid.
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
   * Lists the names of databases registered by the authenticated user.
   * Requires a valid token to be set on the client.
   * @returns An object containing a list of databases along with their metadata.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async list(): Promise<DbListResponse> {
    return makeRequest<DbListResponse>('api/v1/databases', 'GET', this.getRequestContext());
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
   * Retrieves the API key for a specific database.
   * Requires a valid JWT token (not API key auth).
   * @param dbName - The name of the database.
   * @returns The API key response.
   * @throws {NotFoundError} If the database does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async getApiKey(dbName: string): Promise<ApiKeyResponse> {
    if (!dbName) throw new Error('Database name is required.');
    const path = `api/v1/account/databases/${encodeURIComponent(dbName)}/apikey`;
    return makeRequest<ApiKeyResponse>(path, 'GET', this.getRequestContext());
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
