import { NebulaError, NetworkError } from '../errors';
import { makeBinaryRequest, makeRequest } from '../http';
import { SQLExport, SQLiteExport } from '../types';
import { ModuleContext } from './_common';

export class ExportModule {
  constructor(private readonly context: ModuleContext) {}

  /** Export schema and data as SQL using a JWT or database-scoped API key. */
  async sql(dbName: string): Promise<SQLExport> {
    return makeRequest<SQLExport>(this.path(dbName, 'sql'), 'GET', {
      ...this.context.config,
      authToken: this.context.getAuthToken(),
    });
  }

  /**
   * Buffer a standalone snapshot, including committed WAL data. Checks the SQLite header,
   * not database integrity; the full download must fit in memory and the configured timeout.
   */
  async sqlite(dbName: string): Promise<SQLiteExport> {
    const data = await makeBinaryRequest(this.path(dbName, 'sqlite'), {
      ...this.context.config,
      authToken: this.context.getAuthToken(),
    });
    const signature = 'SQLite format 3\0';
    if (
      !Array.from(signature).every((character, index) => data[index] === character.charCodeAt(0))
    ) {
      throw new NetworkError('Received an invalid SQLite snapshot header from the API.');
    }
    return { data, filename: `${dbName}.db` };
  }

  private path(dbName: string, format: 'sql' | 'sqlite'): string {
    if (typeof dbName !== 'string' || !dbName.trim()) {
      throw new NebulaError('Database name is required.');
    }
    return `api/v1/databases/${encodeURIComponent(dbName)}/export/${format}`;
  }
}
