// src/modules/schema.ts
import { makeRequest } from '../http';
import { SchemaPayload, SchemaInfoResponse, TableListResponse } from '../types';
import { ModuleContext } from './_common'; // Assuming ModuleContext is defined/shared

export class SchemaModule {
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
   * Defines a table schema within a specified database.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database where the table will be created.
   * @param payload - Object containing the table name and column definitions.
   * @returns Information about the created table schema.
   * @throws {BadRequestError} If the payload is invalid (e.g., bad types, missing fields).
   * @throws {NotFoundError} If the database `dbName` doesn't exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} If the table name already exists or for other errors.
   */
  async define(dbName: string, payload: SchemaPayload): Promise<SchemaInfoResponse> {
    if (!dbName) throw new Error('Database name is required.');
    if (!payload || !payload.table_name || !payload.columns || payload.columns.length === 0) {
      throw new Error('Table name and at least one column definition are required.');
      // Add more specific validation for column definitions if desired
    }
    const path = `api/v1/databases/${encodeURIComponent(dbName)}/schema`;
    return makeRequest<SchemaInfoResponse>(
      path,
      'POST',
      this.getRequestContext(),
      undefined,
      payload
    );
  }

  /**
   * Lists the names of tables within a specified database.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database to query.
   * @returns An object containing a list of table names.
   * @throws {NotFoundError} If the database `dbName` doesn't exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async listTables(dbName: string): Promise<TableListResponse> {
    if (!dbName) throw new Error('Database name is required.');
    const path = `api/v1/databases/${encodeURIComponent(dbName)}/tables`;
    return makeRequest<TableListResponse>(path, 'GET', this.getRequestContext());
  }

  /**
   * Retrieves the schema for a specific table within a database.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table to get the schema for.
   * @returns The schema information for the table.
   * @throws {NotFoundError} If the database or table doesn't exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async getSchema(dbName: string, tableName: string): Promise<SchemaInfoResponse> {
    if (!dbName) throw new Error('Database name is required.');
    if (!tableName) throw new Error('Table name is required.');
    const path = `api/v1/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/schema`;
    return makeRequest<SchemaInfoResponse>(path, 'GET', this.getRequestContext());
  }

  /**
   * Creates a new table within a specified database.
   * Uses the /tables endpoint (alternative to define which uses /schema).
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database where the table will be created.
   * @param payload - Object containing the table name and column definitions.
   * @returns Information about the created table.
   * @throws {BadRequestError} If the payload is invalid (e.g., bad types, missing fields).
   * @throws {NotFoundError} If the database `dbName` doesn't exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} If the table name already exists or for other errors.
   */
  async createTable(dbName: string, payload: SchemaPayload): Promise<SchemaInfoResponse> {
    if (!dbName) throw new Error('Database name is required.');
    if (!payload || !payload.table_name || !payload.columns || payload.columns.length === 0) {
      throw new Error('Table name and at least one column definition are required.');
    }
    const path = `api/v1/databases/${encodeURIComponent(dbName)}/tables`;
    return makeRequest<SchemaInfoResponse>(
      path,
      'POST',
      this.getRequestContext(),
      undefined,
      payload
    );
  }

  /**
   * Deletes (drops) a table within a specified database.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table to delete.
   * @returns A promise that resolves when deletion is successful (API returns 204 No Content).
   * @throws {NotFoundError} If the database or table name does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async deleteTable(dbName: string, tableName: string): Promise<void> {
    if (!dbName) throw new Error('Database name is required.');
    if (!tableName) throw new Error('Table name is required.');
    const path = `api/v1/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}`;
    await makeRequest<null>(path, 'DELETE', this.getRequestContext());
    // If makeRequest didn't throw, the operation succeeded.
  }
}
