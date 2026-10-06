import { NebulaError } from '../errors';
import { makeRequest } from '../http';
import { SchemaDiagram } from '../types';
import { ModuleContext } from './_common';

export class DiagramModule {
  constructor(private readonly context: ModuleContext) {}

  /**
   * Retrieves tables, columns, and foreign-key metadata using a JWT or scoped API key.
   * Returns schema data without rendering a diagram or generating canvas positions.
   * @throws {NebulaError} If the database name is empty.
   * @throws {BadRequestError} If the backend rejects the database name.
   * @throws {AuthError} If credentials are missing or invalid.
   * @throws {ForbiddenError} If the database is outside the API key's scope.
   * @throws {NotFoundError} If the database does not exist for the authenticated owner.
   * @throws {ServerError} If the backend cannot inspect the schema.
   */
  async get(dbName: string): Promise<SchemaDiagram> {
    if (typeof dbName !== 'string' || !dbName.trim()) {
      throw new NebulaError('Database name is required.');
    }
    return makeRequest<SchemaDiagram>(
      `api/v1/databases/${encodeURIComponent(dbName)}/diagram`,
      'GET',
      { ...this.context.config, authToken: this.context.getAuthToken() }
    );
  }
}
