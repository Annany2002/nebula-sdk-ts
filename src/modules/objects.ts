import { NebulaError } from '../errors';
import { makeRequest } from '../http';
import { DatabaseObjects } from '../types';
import { ModuleContext } from './_common';

export class ObjectsModule {
  constructor(private readonly context: ModuleContext) {}

  /**
   * Retrieves custom index and trigger metadata using a JWT or scoped API key.
   * This endpoint is read-only; create or remove objects through the SQL module.
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
}
