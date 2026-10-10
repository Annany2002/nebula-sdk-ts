import { SQLiteExport } from './export';

/** Owner-managed snapshot metadata. Deleted UUIDs remain reserved but are not listed. */
export interface DatabaseBackup {
  backup_id: string;
  db_name: string;
  status: 'creating' | 'ready' | 'deleting';
  /** Pending creation may report zero until its snapshot is committed. */
  size_bytes: number;
  /** SHA-256 hex digest; may be empty during creation. */
  sha256: string;
  created_at: string;
}

export interface BackupResponse {
  backup: DatabaseBackup;
}

export interface BackupListResponse {
  backups: DatabaseBackup[];
  pagination: { total: number; limit: number; offset: number };
}

export interface BackupListOptions {
  /** Source name, even if that database has since been deleted. Omit for account history. */
  db_name?: string;
  /** 1–100; defaults to 20. */
  limit?: number;
  /** 0–1,000,000; defaults to 0. */
  offset?: number;
}

export interface CreateBackupPayload {
  /** Retain a canonical lowercase, nonzero UUID and reuse it for the same creation intent. */
  backup_id: string;
}

export interface RestoreBackupPayload {
  /** New name: 1–64 ASCII letters, digits or underscores. Never overwrites a database. */
  db_name: string;
}

export interface RestoreBackupResponse {
  message: string;
  backup_id: string;
  db_name: string;
  size_bytes: number;
}

export interface BackupRequestOptions {
  /** Stops waiting, without confirming rollback. Check status before retrying writes. */
  signal?: AbortSignal;
  /** Per-request deadline in milliseconds; defaults to the client timeout. */
  timeout?: number;
}

/** Buffered download verified against saved metadata and SHA-256. */
export interface BackupDownload extends SQLiteExport {
  backup: DatabaseBackup;
}
