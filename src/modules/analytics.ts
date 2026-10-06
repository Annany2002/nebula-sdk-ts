import { NebulaError } from '../errors';
import { makeRequest } from '../http';
import { DatabaseAnalytics } from '../types';
import { ModuleContext } from './_common';

export class AnalyticsModule {
  constructor(private readonly context: ModuleContext) {}

  /**
   * Retrieves request telemetry and schema advisor findings using a JWT or scoped API key.
   * The backend uses a fixed 24-hour window. Recent requests may not appear immediately.
   * @throws {NebulaError} If the database name is empty.
   * @throws {BadRequestError} If the backend rejects the database name.
   * @throws {AuthError} If credentials are missing or invalid.
   * @throws {ForbiddenError} If the database is outside the API key's scope.
   * @throws {NotFoundError} If the database does not exist for the authenticated owner.
   * @throws {ServerError} If the backend cannot compute the report.
   */
  async get(dbName: string): Promise<DatabaseAnalytics> {
    if (typeof dbName !== 'string' || !dbName.trim()) {
      throw new NebulaError('Database name is required.');
    }
    return makeRequest<DatabaseAnalytics>(
      `api/v1/databases/${encodeURIComponent(dbName)}/analytics`,
      'GET',
      { ...this.context.config, authToken: this.context.getAuthToken() }
    );
  }
}
