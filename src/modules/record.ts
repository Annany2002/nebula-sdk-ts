// src/modules/record.ts
import { makeRequest } from '../http';
import { CreateRecordPayload, UpdateRecordPayload, RecordResponse, FilterParams, ListOptions } from '../types';
import { ModuleContext } from './_common';

export class RecordModule {
  private context: ModuleContext;

  constructor(context: ModuleContext) {
    this.context = context;
  }

  private getRequestContext() {
    return {
      ...this.context.config,
      authToken: this.context.getAuthToken(),
    };
  }

  private buildRecordPath(dbName: string, tableName: string, recordId?: number): string {
    if (!dbName) throw new Error('Database name is required.');
    if (!tableName) throw new Error('Table name is required.');

    let path = `api/v1/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/records`;
    if (recordId !== undefined) {
      // Basic validation for numeric ID
      if (typeof recordId !== 'number' || !Number.isInteger(recordId) || recordId <= 0) {
        throw new Error('Record ID must be a positive integer.');
      }
      path += `/${recordId}`;
    }
    return path;
  }

  /**
   * Creates a new record in the specified table.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table where the record will be created.
   * @param payload - The data for the new record.
   * @returns The newly created record, including its system-assigned ID.
   * @throws {BadRequestError} If the payload data doesn't match the table schema or is invalid.
   * @throws {NotFoundError} If the database or table name does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async create(
    dbName: string,
    tableName: string,
    payload: CreateRecordPayload
  ): Promise<RecordResponse> {
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      throw new Error('Record data payload cannot be empty.');
    }
    const path = this.buildRecordPath(dbName, tableName);
    return makeRequest<RecordResponse>(
      path,
      'POST',
      this.getRequestContext(),
      undefined, // No query params
      payload
    );
  }

  /**
   * Lists records in the specified table, optionally filtering by column values.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table to list records from.
   * @param filter - Optional object for basic equality filtering (e.g., { column: value }).
   * @param options - Optional pagination, sorting, and field selection options.
   * @returns An array of record objects matching the criteria.
   * @throws {NotFoundError} If the database or table name does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {BadRequestError} If filter parameters are invalid for the schema.
   * @throws {ApiError} For other API-related errors.
   */
  async list(dbName: string, tableName: string, filter?: FilterParams, options?: ListOptions): Promise<RecordResponse[]> {
    const path = this.buildRecordPath(dbName, tableName);
    // Merge filter and options into a single query params object
    const queryParams: Record<string, string | number | boolean> = { ...filter };
    if (options) {
      if (options.limit !== undefined) queryParams.limit = options.limit;
      if (options.offset !== undefined) queryParams.offset = options.offset;
      if (options.sort) queryParams.sort = options.sort;
      if (options.order) queryParams.order = options.order;
      if (options.fields) queryParams.fields = options.fields;
    }
    return makeRequest<RecordResponse[]>(
      path,
      'GET',
      this.getRequestContext(),
      Object.keys(queryParams).length > 0 ? queryParams : undefined
    );
  }

  /**
   * Retrieves a single record by its ID.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table containing the record.
   * @param recordId - The unique ID of the record to retrieve.
   * @returns The requested record object.
   * @throws {NotFoundError} If the database, table, or record ID does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async get(dbName: string, tableName: string, recordId: number): Promise<RecordResponse> {
    const path = this.buildRecordPath(dbName, tableName, recordId);
    return makeRequest<RecordResponse>(path, 'GET', this.getRequestContext());
  }

  /**
   * Updates an existing record by its ID.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table containing the record.
   * @param recordId - The unique ID of the record to update.
   * @param payload - An object containing the fields to update.
   * @returns The full updated record object.
   * @throws {BadRequestError} If the payload data doesn't match the table schema or is invalid.
   * @throws {NotFoundError} If the database, table, or record ID does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async update(
    dbName: string,
    tableName: string,
    recordId: number,
    payload: UpdateRecordPayload
  ): Promise<RecordResponse> {
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      throw new Error('Update payload cannot be empty.');
    }
    const path = this.buildRecordPath(dbName, tableName, recordId);
    return makeRequest<RecordResponse>(path, 'PUT', this.getRequestContext(), undefined, payload);
  }

  /**
   * Deletes a record by its ID.
   * Requires a valid token to be set on the client.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table containing the record.
   * @param recordId - The unique ID of the record to delete.
   * @returns A promise that resolves when deletion is successful (API returns 204 No Content).
   * @throws {NotFoundError} If the database, table, or record ID does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async delete(dbName: string, tableName: string, recordId: number): Promise<void> {
    const path = this.buildRecordPath(dbName, tableName, recordId);
    await makeRequest<null>(path, 'DELETE', this.getRequestContext());
    // Success if no error thrown
  }
}
