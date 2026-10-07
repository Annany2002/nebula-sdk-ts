import { NebulaError } from '../errors';
import { makeRequest } from '../http';
import {
  DatabaseObjects,
  CreateIndexPayload,
  CreateIndexResponse,
  DropIndexResponse,
  CreateTriggerPayload,
  CreateTriggerResponse,
  DropTriggerResponse,
} from '../types';
import { ModuleContext } from './_common';

export class ObjectsModule {
  constructor(private readonly context: ModuleContext) {}

  /**
   * Retrieves custom index and trigger metadata using a JWT or scoped API key.
   * The catalog is read-only. Manage column indexes and table triggers with the native methods.
   * @throws {NebulaError} If the database name is empty.
   * @throws {BadRequestError} If the backend rejects the database name.
   * @throws {AuthError} If credentials are missing or invalid.
   * @throws {ForbiddenError} If the database is outside the API key's scope.
   * @throws {NotFoundError} If the database does not exist for the authenticated owner.
   * @throws {ServerError} If the backend cannot inspect the objects.
   */
  async get(dbName: string): Promise<DatabaseObjects> {
    if (typeof dbName !== 'string' || !dbName.trim()) {
      throw new NebulaError('Database name is required.');
    }
    return makeRequest<DatabaseObjects>(
      `api/v1/databases/${encodeURIComponent(dbName)}/objects`,
      'GET',
      { ...this.context.config, authToken: this.context.getAuthToken() }
    );
  }

  /**
   * Creates an ordinary or unique column index using a JWT or database-scoped API key.
   * Columns retain their supplied order. The server validates schema and reserved objects.
   * Existing names or data violating uniqueness cause ConflictError. Writes are never retried.
   */
  async createIndex(dbName: string, payload: CreateIndexPayload): Promise<CreateIndexResponse> {
    if (typeof dbName !== 'string' || !dbName.trim())
      throw new NebulaError('Database name is required.');
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.name !== 'string' ||
      !payload.name ||
      typeof payload.table_name !== 'string' ||
      !payload.table_name
    ) {
      throw new NebulaError('Index name and table name are required.');
    }
    if (
      !Array.isArray(payload.columns) ||
      payload.columns.length < 1 ||
      payload.columns.length > 64 ||
      payload.columns.some((column) => typeof column !== 'string' || !column)
    ) {
      throw new NebulaError('One to 64 non-empty column names are required.');
    }
    if (payload.unique !== undefined && typeof payload.unique !== 'boolean')
      throw new NebulaError('Index uniqueness must be a boolean.');
    return makeRequest<CreateIndexResponse>(
      `api/v1/databases/${encodeURIComponent(dbName)}/indexes`,
      'POST',
      { ...this.context.config, authToken: this.context.getAuthToken() },
      undefined,
      payload
    );
  }

  /**
   * Drops a custom index, preserving table records. Dropping a unique index removes its constraint.
   * Legacy quoted names are supported. Protected/automatic indexes cause BadRequestError;
   * an absent index causes NotFoundError. Failed or repeated writes are never retried.
   */
  async dropIndex(dbName: string, indexName: string): Promise<DropIndexResponse> {
    if (typeof dbName !== 'string' || !dbName.trim())
      throw new NebulaError('Database name is required.');
    if (typeof indexName !== 'string' || !indexName)
      throw new NebulaError('Index name is required.');
    return makeRequest<DropIndexResponse>(
      `api/v1/databases/${encodeURIComponent(dbName)}/indexes/${encodeURIComponent(indexName)}`,
      'DELETE',
      { ...this.context.config, authToken: this.context.getAuthToken() }
    );
  }

  /**
   * Creates a table trigger using a JWT or database-scoped API key. SQL and schema validation
   * remain on the server; creation compiles the trigger without executing its actions.
   * The body contains SQL statements without a CREATE TRIGGER / BEGIN / END wrapper.
   * Existing schema-object names cause ConflictError. Writes are never retried.
   */
  async createTrigger(
    dbName: string,
    payload: CreateTriggerPayload
  ): Promise<CreateTriggerResponse> {
    if (typeof dbName !== 'string' || !dbName.trim())
      throw new NebulaError('Database name is required.');
    validateTriggerPayload(payload);
    return makeRequest<CreateTriggerResponse>(
      `api/v1/databases/${encodeURIComponent(dbName)}/triggers`,
      'POST',
      { ...this.context.config, authToken: this.context.getAuthToken() },
      undefined,
      payload
    );
  }

  /**
   * Drops a custom table or view trigger, preserving records and previous trigger effects.
   * Legacy quoted names are supported; protected names/targets cause BadRequestError.
   * An absent trigger causes NotFoundError. Failed or repeated writes are never retried.
   */
  async dropTrigger(dbName: string, triggerName: string): Promise<DropTriggerResponse> {
    if (typeof dbName !== 'string' || !dbName.trim())
      throw new NebulaError('Database name is required.');
    if (typeof triggerName !== 'string' || !triggerName)
      throw new NebulaError('Trigger name is required.');
    return makeRequest<DropTriggerResponse>(
      `api/v1/databases/${encodeURIComponent(dbName)}/triggers/${encodeURIComponent(triggerName)}`,
      'DELETE',
      { ...this.context.config, authToken: this.context.getAuthToken() }
    );
  }
}

function validateTriggerPayload(payload: CreateTriggerPayload): void {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.name !== 'string' ||
    !payload.name ||
    typeof payload.table_name !== 'string' ||
    !payload.table_name
  )
    throw new NebulaError('Trigger name and table name are required.');
  const event = typeof payload.event === 'string' ? payload.event.trim().toUpperCase() : '';
  if (!['INSERT', 'UPDATE', 'DELETE'].includes(event))
    throw new NebulaError('Trigger event must be INSERT, UPDATE or DELETE.');
  if (
    payload.timing !== undefined &&
    (typeof payload.timing !== 'string' ||
      !['', 'AFTER', 'BEFORE'].includes(payload.timing.trim().toUpperCase()))
  )
    throw new NebulaError('Trigger timing must be AFTER or BEFORE.');
  if (payload.update_of !== undefined) {
    if (
      !Array.isArray(payload.update_of) ||
      payload.update_of.length > 64 ||
      payload.update_of.some((column) => typeof column !== 'string' || !column) ||
      (payload.update_of.length > 0 && event !== 'UPDATE')
    )
      throw new NebulaError('update_of accepts up to 64 non-empty column names, only for UPDATE.');
  }
  const encoder = new TextEncoder();
  if (
    typeof payload.body !== 'string' ||
    !payload.body.trim() ||
    payload.body.includes('\0') ||
    encoder.encode(payload.body).length > 64 * 1024
  )
    throw new NebulaError('Trigger body must be non-empty SQL up to 64 KiB of UTF-8, without NUL.');
  if (
    payload.when !== undefined &&
    (typeof payload.when !== 'string' ||
      payload.when.includes('\0') ||
      encoder.encode(payload.when).length > 8 * 1024)
  )
    throw new NebulaError('Trigger condition must be SQL up to 8 KiB of UTF-8, without NUL.');
}
