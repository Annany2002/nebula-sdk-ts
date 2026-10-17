import { AuthRequestOptions } from './auth';

/** Owner metadata counts, not tenant-file health or backup-integrity checks. */
export interface AccountSummary {
  database_count: number;
  /** Stored keys whose databases still belong to this owner. */
  active_api_key_count: number;
  /** Includes retained ready snapshots of deleted source databases. */
  ready_backup_count: number;
}

export interface AccountSummaryResponse {
  summary: AccountSummary;
}

/** JWT-only operations share auth cancellation and total-deadline options. */
export type ManagementRequestOptions = AuthRequestOptions;
