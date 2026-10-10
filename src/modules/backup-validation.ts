import { NebulaError, NetworkError } from '../errors';
import { BackupListOptions, BackupListResponse, DatabaseBackup } from '../types';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

export function validateBackupID(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ||
    value === '00000000-0000-0000-0000-000000000000'
  ) {
    throw new NebulaError('backup_id must be a canonical lowercase, nonzero UUID.');
  }
}

export function validateDatabaseName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(value)) {
    throw new NebulaError('Database name must contain 1–64 ASCII letters, digits or underscores.');
  }
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseBackup(value: unknown): DatabaseBackup {
  const backup = object(value);
  try {
    validateBackupID(backup?.backup_id);
    validateDatabaseName(backup?.db_name);
  } catch {
    throw new NetworkError('Received invalid backup metadata from the API.');
  }
  if (
    !backup ||
    !['creating', 'ready', 'deleting'].includes(backup.status as string) ||
    !Number.isSafeInteger(backup.size_bytes) ||
    (backup.size_bytes as number) < 0 ||
    (backup.size_bytes as number) > MAX_BACKUP_BYTES ||
    typeof backup.sha256 !== 'string' ||
    (backup.sha256 !== '' && !/^[0-9a-f]{64}$/.test(backup.sha256)) ||
    (backup.status === 'ready' && ((backup.size_bytes as number) < 512 || !backup.sha256)) ||
    typeof backup.created_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      backup.created_at
    ) ||
    !Number.isFinite(Date.parse(backup.created_at))
  ) {
    throw new NetworkError('Received invalid backup metadata from the API.');
  }
  return {
    backup_id: backup.backup_id as string,
    db_name: backup.db_name as string,
    status: backup.status as DatabaseBackup['status'],
    size_bytes: backup.size_bytes as number,
    sha256: backup.sha256,
    created_at: backup.created_at,
  };
}

export function backupQuery(options: BackupListOptions): Record<string, string | number> {
  const fields = object(options);
  if (!fields || Object.keys(fields).some((key) => !['db_name', 'limit', 'offset'].includes(key))) {
    throw new NebulaError('Backup list options accept only db_name, limit and offset.');
  }
  if (options.db_name !== undefined) validateDatabaseName(options.db_name);
  if (options.limit === null || options.offset === null) {
    throw new NebulaError('Backup pagination cannot be null.');
  }
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new NebulaError('Backup limit must be an integer from 1 to 100.');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new NebulaError('Backup offset must be an integer from 0 to 1000000.');
  }
  return { ...(options.db_name === undefined ? {} : { db_name: options.db_name }), limit, offset };
}

export function parseBackupList(
  value: unknown,
  query: Record<string, string | number>
): BackupListResponse {
  const result = object(value);
  const pagination = object(result?.pagination);
  if (
    !Array.isArray(result?.backups) ||
    !pagination ||
    !Number.isSafeInteger(pagination.total) ||
    (pagination.total as number) < 0 ||
    pagination.limit !== query.limit ||
    pagination.offset !== query.offset ||
    result.backups.length > (query.limit as number)
  ) {
    throw new NetworkError('Received invalid backup pagination from the API.');
  }
  const backups = result.backups.map(parseBackup);
  if (
    new Set(backups.map((backup) => backup.backup_id)).size !== backups.length ||
    backups.some((backup) => query.db_name !== undefined && backup.db_name !== query.db_name)
  ) {
    throw new NetworkError('Received mismatched backup history from the API.');
  }
  return {
    backups,
    pagination: {
      total: pagination.total as number,
      limit: pagination.limit as number,
      offset: pagination.offset as number,
    },
  };
}

export async function verifyBackupBytes(data: Uint8Array, backup: DatabaseBackup): Promise<void> {
  if (!Array.from('SQLite format 3\0').every((char, i) => data[i] === char.charCodeAt(0))) {
    throw new NetworkError('Received an invalid SQLite backup header.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(data));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  if (hash !== backup.sha256)
    throw new NetworkError('Backup download failed SHA-256 verification.');
}
