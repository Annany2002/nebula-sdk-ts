// src/modules/record.ts
import { makeRequest } from '../http';
import {
  CreateRecordPayload,
  UpdateRecordPayload,
  RecordResponse,
  RecordId,
  RecordMutationResponse,
  RecordListResponse,
  FilterParams,
  ListOptions,
} from '../types';
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

  private buildRecordPath(dbName: string, tableName: string): string {
    if (!dbName) throw new Error('Database name is required.');
    if (!tableName) throw new Error('Table name is required.');
    return `api/v1/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/records`;
  }

  private buildSingleRecordPath(dbName: string, tableName: string, recordId: RecordId): string {
    const path = this.buildRecordPath(dbName, tableName);
    if (
      (typeof recordId !== 'string' && typeof recordId !== 'number') ||
      (typeof recordId === 'string' && recordId.length === 0) ||
      (typeof recordId === 'number' &&
        (!Number.isFinite(recordId) ||
          (Number.isInteger(recordId) && !Number.isSafeInteger(recordId))))
    ) {
      throw new Error(
        'Record ID must be a non-empty string or a finite, safely represented number.'
      );
    }
    return `${path}/${encodeURIComponent(String(recordId))}`;
  }

  /**
   * Creates a new record in the specified table.
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table where the record will be created.
   * @param payload - The data for the new record.
   * @returns A success message and the primary-key value.
   * @throws {BadRequestError} If the payload data doesn't match the table schema or is invalid.
   * @throws {NotFoundError} If the database or table name does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async create(
    dbName: string,
    tableName: string,
    payload: CreateRecordPayload
  ): Promise<RecordMutationResponse> {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).length === 0
    ) {
      throw new Error('Record data payload cannot be empty.');
    }
    const path = this.buildRecordPath(dbName, tableName);
    return makeRequest<RecordMutationResponse>(
      path,
      'POST',
      this.getRequestContext(),
      undefined, // No query params
      payload
    );
  }

  /**
   * Lists records in the specified table, optionally filtering by column values.
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table to list records from.
   * @param filter - Optional object for basic equality filtering (e.g., { column: value }).
   * @param options - Optional pagination, sorting, and field selection options.
   * @returns Matching rows and total/limit/offset pagination metadata.
   * @throws {NotFoundError} If the database or table name does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {BadRequestError} If filter parameters are invalid for the schema.
   * @throws {ApiError} For other API-related errors.
   */
  async list<T extends object = RecordResponse>(
    dbName: string,
    tableName: string,
    filter?: FilterParams,
    options?: ListOptions
  ): Promise<RecordListResponse<T>> {
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
    return makeRequest<RecordListResponse<T>>(
      path,
      'GET',
      this.getRequestContext(),
      Object.keys(queryParams).length > 0 ? queryParams : undefined
    );
  }

  /**
   * Retrieves a single record by its ID.
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table containing the record.
   * @param recordId - The unique ID of the record to retrieve.
   * @returns The requested record object.
   * @throws {NotFoundError} If the database, table, or record ID does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async get<T extends object = RecordResponse>(
    dbName: string,
    tableName: string,
    recordId: RecordId
  ): Promise<T> {
    const path = this.buildSingleRecordPath(dbName, tableName, recordId);
    return makeRequest<T>(path, 'GET', this.getRequestContext());
  }

  /**
   * Updates an existing record by its ID.
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table containing the record.
   * @param recordId - The unique ID of the record to update.
   * @param payload - An object containing the fields to update.
   * @returns A success message and the primary-key value.
   * @throws {BadRequestError} If the payload data doesn't match the table schema or is invalid.
   * @throws {NotFoundError} If the database, table, or record ID does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async update(
    dbName: string,
    tableName: string,
    recordId: RecordId,
    payload: UpdateRecordPayload
  ): Promise<RecordMutationResponse> {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).length === 0
    ) {
      throw new Error('Update payload cannot be empty.');
    }
    const path = this.buildSingleRecordPath(dbName, tableName, recordId);
    return makeRequest<RecordMutationResponse>(
      path,
      'PUT',
      this.getRequestContext(),
      undefined,
      payload
    );
  }

  /**
   * Deletes a record by its ID.
   * Accepts a JWT session or database API key.
   * @param dbName - The name of the database containing the table.
   * @param tableName - The name of the table containing the record.
   * @param recordId - The unique ID of the record to delete.
   * @returns A promise that resolves when deletion is successful (API returns 204 No Content).
   * @throws {NotFoundError} If the database, table, or record ID does not exist.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async delete(dbName: string, tableName: string, recordId: RecordId): Promise<void> {
    const path = this.buildSingleRecordPath(dbName, tableName, recordId);
    await makeRequest<null>(path, 'DELETE', this.getRequestContext());
    // Success if no error thrown
  }
}
