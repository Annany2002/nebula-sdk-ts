// src/modules/schema.ts
import { makeRequest } from '../http';
import {
  SchemaPayload,
  SchemaInfoResponse,
  SchemaCreateResponse,
  TableListResponse,
  AlterTablePayload,
  AlterTableResponse,
} from '../types';
import { ModuleContext } from './_common';
import { NebulaError } from '../errors';

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
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database where the table will be created.
   * @param payload - Object containing the table name and column definitions.
   * @returns A creation acknowledgement; an existing table is left unchanged.
   * @throws {BadRequestError} If the payload is invalid (e.g., bad types, missing fields).
   * @throws {NotFoundError} If the database `dbName` doesn't exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} If the table name already exists or for other errors.
   */
  async define(dbName: string, payload: SchemaPayload): Promise<SchemaCreateResponse> {
    if (!dbName) throw new Error('Database name is required.');
    if (
      !payload ||
      !payload.table_name ||
      !(
        (Array.isArray(payload.columns) && payload.columns.length > 0) ||
        (Array.isArray(payload.schema) && payload.schema.length > 0)
      )
    ) {
      throw new Error('Table name and at least one column definition are required.');
    }
    const path = `api/v1/databases/${encodeURIComponent(dbName)}/schema`;
    return makeRequest<SchemaCreateResponse>(
      path,
      'POST',
      this.getRequestContext(),
      undefined,
      payload
    );
  }

  /**
   * Lists tables and their SQLite metadata within a specified database.
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database to query.
   * @returns Table metadata including row counts and PRAGMA column information.
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
   * Accepts a JWT session or database API key.
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
   * Alter a table using a JWT or database-scoped API key. Batches run in order in a
   * server transaction; dropping columns removes their data. Failed writes are never retried.
   */
  async alterTable(
    dbName: string,
    tableName: string,
    payload: AlterTablePayload
  ): Promise<AlterTableResponse> {
    if (typeof dbName !== 'string' || !dbName.trim())
      throw new NebulaError('Database name is required.');
    if (typeof tableName !== 'string' || !tableName.trim())
      throw new NebulaError('Table name is required.');
    if (!payload || typeof payload !== 'object')
      throw new NebulaError('An alteration operation is required.');
    const operations =
      'operations' in payload && Array.isArray(payload.operations) && payload.operations.length > 0
        ? payload.operations
        : 'action' in payload
          ? [payload]
          : [];
    if (
      operations.length === 0 ||
      operations.some(
        (operation) =>
          !operation ||
          !['add_column', 'drop_column', 'rename_column', 'rename_table'].includes(operation.action)
      )
    ) {
      throw new NebulaError('At least one supported alteration operation is required.');
    }
    return makeRequest<AlterTableResponse>(
      `api/v1/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/alter`,
      'POST',
      this.getRequestContext(),
      undefined,
      payload
    );
  }

  /**
   * Creates a new table within a specified database.
   * Uses the /tables endpoint (alternative to define which uses /schema).
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database where the table will be created.
   * @param payload - Object containing the table name and column definitions.
   * @returns A creation acknowledgement; an existing table is left unchanged.
   * @throws {BadRequestError} If the payload is invalid (e.g., bad types, missing fields).
   * @throws {NotFoundError} If the database `dbName` doesn't exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} If the table name already exists or for other errors.
   */
  async createTable(dbName: string, payload: SchemaPayload): Promise<SchemaCreateResponse> {
    if (!dbName) throw new Error('Database name is required.');
    if (
      !payload ||
      !payload.table_name ||
      !(
        (Array.isArray(payload.columns) && payload.columns.length > 0) ||
        (Array.isArray(payload.schema) && payload.schema.length > 0)
      )
    ) {
      throw new Error('Table name and at least one column definition are required.');
    }
    const path = `api/v1/databases/${encodeURIComponent(dbName)}/tables`;
    return makeRequest<SchemaCreateResponse>(
      path,
      'POST',
      this.getRequestContext(),
      undefined,
      payload
    );
  }

  /**
   * Deletes (drops) a table within a specified database.
   * Accepts a JWT session or database API key.
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
