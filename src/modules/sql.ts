import { NebulaError } from '../errors';
import { makeRequest } from '../http';
import { SQLQueryResult } from '../types';
import { ModuleContext } from './_common';

export class SQLModule {
  constructor(private readonly context: ModuleContext) {}

  /**
   * Executes SQL within the selected database using a JWT or scoped database API key.
   * Writes take effect immediately. The endpoint accepts SQL text without bound parameters.
   * @returns The backend's raw result, including optional columns/rows and execution metadata.
   * @throws {NebulaError} If the database name or SQL text is empty.
   * @throws {BadRequestError} If SQL is invalid or a statement is rejected by the backend.
   * @throws {AuthError} If credentials are missing or invalid.
   * @throws {ForbiddenError} If the database is outside the API key's scope.
   * @throws {NotFoundError} If the database does not exist.
   */
  async execute<TRow extends unknown[] = unknown[]>(
    dbName: string,
    query: string
  ): Promise<SQLQueryResult<TRow>> {
    if (typeof dbName !== 'string' || !dbName.trim()) {
      throw new NebulaError('Database name is required.');
    }
    if (typeof query !== 'string' || !query.trim()) {
      throw new NebulaError('SQL query must be a non-empty string.');
    }
    return makeRequest<SQLQueryResult<TRow>>(
      `api/v1/databases/${encodeURIComponent(dbName)}/sql`,
      'POST',
      { ...this.context.config, authToken: this.context.getAuthToken() },
      undefined,
      { query }
    );
  }
}
