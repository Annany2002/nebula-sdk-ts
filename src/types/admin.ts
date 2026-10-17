import { PlatformRole } from './common';

export type AccountStatus = 'active' | 'suspended';
export type AdminAuditAction = 'suspend' | 'activate';

/** Safe metadata only. Membership grants no access to the account's tenant rows. */
export interface AdminUser {
  user_id: string;
  username: string;
  email: string;
  created_at: string;
  email_verified: boolean;
  verification_required: boolean;
  role: PlatformRole;
  status: AccountStatus;
  database_count: number;
}

export interface AdminPagination {
  total: number;
  limit: number;
  offset: number;
}

export interface AdminPageOptions {
  /** 1–100, default 20. Separate pages are separate metadata snapshots. */
  limit?: number;
  /** 0–1,000,000, default 0. */
  offset?: number;
}

export interface AdminUserListOptions extends AdminPageOptions {
  /** Literal username/email substring, max 100 Unicode code points. No wildcard syntax. */
  q?: string;
  role?: PlatformRole;
  status?: AccountStatus;
}

export interface AdminUserListResponse {
  users: AdminUser[];
  pagination: AdminPagination;
}

export interface AdminUserResponse {
  user: AdminUser;
}

export interface PlatformStats {
  total_users: number;
  total_databases: number;
  /** Null if any registered tenant schema could not be inspected. */
  total_tables: number | null;
  databases_counted: number;
  databases_unavailable: number;
}

export interface PlatformStatsResponse {
  stats: PlatformStats;
}

/** Actual suspension/activation transitions. IDs survive account deletion. */
export interface AdminAuditEvent {
  event_id: number;
  actor_user_id: string;
  target_user_id: string;
  action: AdminAuditAction;
  created_at: string;
}

export interface AdminAuditListOptions extends AdminPageOptions {
  /** Exact account ID, at most 128 Unicode code points. */
  actor_user_id?: string;
  /** Exact account ID, at most 128 Unicode code points. */
  target_user_id?: string;
  action?: AdminAuditAction;
}

export interface AdminAuditListResponse {
  events: AdminAuditEvent[];
  pagination: AdminPagination;
}
