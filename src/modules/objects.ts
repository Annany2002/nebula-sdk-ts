import { NebulaError } from '../errors';
import { makeRequest } from '../http';
import {
  DatabaseObjects,
  CreateIndexPayload,
  CreateIndexResponse,
  DropIndexResponse,
} from '../types';
import { ModuleContext } from './_common';

export class ObjectsModule {
  constructor(private readonly context: ModuleContext) {}

  /**
   * Retrieves custom index and trigger metadata using a JWT or scoped API key.
   * The catalog is read-only. Manage column indexes with createIndex/dropIndex; triggers use SQL.
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
}
