// src/modules/database.ts
import { makeRequest } from "../http";
import { DbCreatePayload, DbInfoResponse, DbListResponse } from "../types";
import { ModuleContext } from "./_common";

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
   * Registers a new database name for the authenticated user.
   * Requires a valid token to be set on the client.
   * @param payload - Object containing the database name { db_name: string }.
   * @returns Information about the created database registration.
   * @throws {BadRequestError} If the name is invalid or already exists.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async create(payload: DbCreatePayload): Promise<DbInfoResponse> {
    if (!payload || !payload.db_name) {
      throw new Error("Database name (db_name) is required.");
    }
    return makeRequest<DbInfoResponse>(
      "api/v1/databases",
      "POST",
      this.getRequestContext(),
      undefined, // No query params
      payload,
    );
  }

  /**
   * Lists the names of databases registered by the authenticated user.
   * Requires a valid token to be set on the client.
   * @returns An object containing a list of database names.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async list(): Promise<DbListResponse> {
    return makeRequest<DbListResponse>(
      "api/v1/databases",
      "GET",
      this.getRequestContext(),
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
      throw new Error("Database name is required for deletion.");
    }
    // Expecting 204 No Content, makeRequest returns null which we map to void
    await makeRequest<null>(
      `api/v1/databases/${encodeURIComponent(dbName)}`,
      "DELETE",
      this.getRequestContext(),
    );
    // If makeRequest didn't throw, the operation succeeded.
  }
}
