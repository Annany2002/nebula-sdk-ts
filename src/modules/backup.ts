import { NebulaError, NetworkError } from '../errors';
import { makeBinaryRequest, makeRequest, RequestContext } from '../http';
import {
  BackupDownload,
  BackupListOptions,
  BackupListResponse,
  BackupRequestOptions,
  BackupResponse,
  CreateBackupPayload,
  RestoreBackupPayload,
  RestoreBackupResponse,
} from '../types';
import { ModuleContext } from './_common';
import {
  backupQuery,
  MAX_BACKUP_BYTES,
  object,
  parseBackup,
  parseBackupList,
  validateBackupID,
  validateDatabaseName,
  verifyBackupBytes,
} from './backup-validation';

/** Account backup management. Every operation requires the owner's JWT and never retries. */
export class BackupModule {
  constructor(private readonly context: ModuleContext) {}

  /** Retain and reuse backup_id after an interrupted creation; a completed replay returns the original. */
  async create(
    dbName: string,
    payload: CreateBackupPayload,
    options: BackupRequestOptions = {}
  ): Promise<BackupResponse> {
    validateDatabaseName(dbName);
    validateBackupID(payload?.backup_id);
    const backupId = payload.backup_id;
    const result = await makeRequest<unknown>(
      `api/v1/databases/${dbName}/backups`,
      'POST',
      this.requestContext(options),
      undefined,
      { backup_id: backupId },
      [200, 201]
    );
    const backup = parseBackup(object(result)?.backup);
    if (backup.backup_id !== backupId || backup.db_name !== dbName || backup.status !== 'ready') {
      throw new NetworkError('Unconfirmed backup creation. Check backup_id before retrying.');
    }
    return { backup };
  }

  /** History survives source deletion. Omit db_name to list snapshots across the account. */
  async list(
    filters: BackupListOptions = {},
    options: BackupRequestOptions = {}
  ): Promise<BackupListResponse> {
    const query = backupQuery(filters);
    const result = await makeRequest<unknown>(
      'api/v1/backups',
      'GET',
      this.requestContext(options),
      query,
      undefined,
      [200]
    );
    return parseBackupList(result, query);
  }

  async get(backupId: string, options: BackupRequestOptions = {}): Promise<BackupResponse> {
    const result = await makeRequest<unknown>(
      this.path(backupId),
      'GET',
      this.requestContext(options),
      undefined,
      undefined,
      [200]
    );
    const backup = parseBackup(object(result)?.backup);
    if (backup.backup_id !== backupId)
      throw new NetworkError('Received mismatched backup metadata.');
    return { backup };
  }

  /** Fetch metadata, then buffer at most 64 MiB and verify size, SQLite header and SHA-256. */
  async download(backupId: string, options: BackupRequestOptions = {}): Promise<BackupDownload> {
    const context = this.requestContext(options);
    if (!globalThis.crypto?.subtle) {
      throw new NebulaError(
        'Backup verification requires Web Crypto (Node.js 24 or a secure browser context).'
      );
    }
    const { backup } = await this.get(backupId, options);
    if (backup.status !== 'ready') throw new NebulaError('Only ready backups can be downloaded.');
    const data = await makeBinaryRequest(`${this.path(backupId)}/download`, context, {
      expectedSize: backup.size_bytes,
      validate: (bytes) => verifyBackupBytes(bytes, backup),
    });
    return { backup, data, filename: `${backupId}.db` };
  }

  /** Restore into a new name. After an unconfirmed response, check databases.list() before retrying. */
  async restore(
    backupId: string,
    payload: RestoreBackupPayload,
    options: BackupRequestOptions = {}
  ): Promise<RestoreBackupResponse> {
    validateDatabaseName(payload?.db_name);
    const dbName = payload.db_name;
    const result = object(
      await makeRequest<unknown>(
        `${this.path(backupId)}/restore`,
        'POST',
        this.requestContext(options),
        undefined,
        { db_name: dbName },
        [201]
      )
    );
    if (
      result?.backup_id !== backupId ||
      result.db_name !== dbName ||
      typeof result.message !== 'string' ||
      !result.message.trim() ||
      !Number.isSafeInteger(result.size_bytes) ||
      (result.size_bytes as number) < 512 ||
      (result.size_bytes as number) > MAX_BACKUP_BYTES
    ) {
      throw new NetworkError(
        'Unconfirmed backup restore. Check the destination database before retrying.'
      );
    }
    return {
      backup_id: backupId,
      db_name: dbName,
      message: result.message,
      size_bytes: result.size_bytes as number,
    };
  }

  /** Idempotent deletion. Removes the snapshot, leaving its source and restored databases intact. */
  async delete(backupId: string, options: BackupRequestOptions = {}): Promise<void> {
    await makeRequest<null>(
      this.path(backupId),
      'DELETE',
      this.requestContext(options),
      undefined,
      undefined,
      [204]
    );
  }

  private path(backupId: string): string {
    validateBackupID(backupId);
    return `api/v1/backups/${backupId}`;
  }

  private requestContext(options: BackupRequestOptions): RequestContext {
    const fields = object(options);
    if (!fields || Object.keys(fields).some((key) => !['timeout', 'signal'].includes(key))) {
      throw new NebulaError('Backup request options accept only timeout and signal.');
    }
    const { timeout, signal } = options;
    if (
      timeout !== undefined &&
      (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
    ) {
      throw new NebulaError('timeout must be an integer from 1 to 2147483647 milliseconds.');
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new NebulaError('signal must be an AbortSignal.');
    }
    return {
      ...this.context.config,
      timeout: timeout ?? this.context.config.timeout,
      signal,
      authentication: 'bearer',
      authToken: this.context.getAuthToken(),
    };
  }
}
