import { NebulaError, NetworkError } from '../errors';
import {
  AccountStatus,
  AccountSummaryResponse,
  AdminAuditEvent,
  AdminAuditListOptions,
  AdminAuditListResponse,
  AdminPagination,
  AdminUser,
  AdminUserListOptions,
  AdminUserListResponse,
  AdminUserResponse,
  PlatformStatsResponse,
} from '../types';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function text(value: unknown, max: number): value is string {
  // Unicode mode treats valid surrogate pairs as code points, rejecting only lone surrogates.
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Array.from(value).length <= max &&
    !/[\p{Cc}\uD800-\uDFFF]/u.test(value)
  );
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function invalidResponse(): never {
  throw new NetworkError(
    'Received inconsistent management metadata. Read current state before retrying a write.'
  );
}

export function validateAccountID(value: unknown): asserts value is string {
  if (!text(value, 128) || value === '.' || value === '..')
    throw new NebulaError(
      'Account ID must contain 1–128 Unicode code points without control characters or path dot segments.'
    );
}

export function adminQuery(
  options: AdminUserListOptions | AdminAuditListOptions,
  kind: 'users' | 'audit'
): Record<string, string | number> {
  const fields = object(options);
  const allowed =
    kind === 'users' ? ['q', 'role', 'status'] : ['actor_user_id', 'target_user_id', 'action'];
  if (!fields || Object.keys(fields).some((key) => !['limit', 'offset', ...allowed].includes(key)))
    throw new NebulaError('Unknown administrator list option.');
  const limit = fields.limit === undefined ? 20 : fields.limit;
  const offset = fields.offset === undefined ? 0 : fields.offset;
  if (
    !Number.isInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 100 ||
    !Number.isInteger(offset) ||
    (offset as number) < 0 ||
    (offset as number) > 1_000_000
  )
    throw new NebulaError('Admin limit must be 1–100 and offset 0–1000000, as integers.');
  const query: Record<string, string | number> = {
    limit: limit as number,
    offset: offset as number,
  };
  for (const key of allowed) {
    const value = fields[key];
    if (value === undefined) continue;
    if (key === 'q' || key.endsWith('_user_id')) {
      if (!text(value, key === 'q' ? 100 : 128))
        throw new NebulaError(
          'Admin search accepts at most 100 Unicode code points; IDs accept 128. Empty values, control characters and malformed Unicode are not allowed.'
        );
    } else {
      const values =
        key === 'role'
          ? ['user', 'admin']
          : key === 'status'
            ? ['active', 'suspended']
            : ['suspend', 'activate'];
      if (typeof value !== 'string' || !values.includes(value))
        throw new NebulaError(`Invalid administrator ${key} filter.`);
    }
    query[key] = value as string;
  }
  const encoded = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) encoded.set(key, String(value));
  if (encoded.toString().length > 2048)
    throw new NebulaError(
      'The encoded administrator query exceeds the server limit of 2048 bytes.'
    );
  return query;
}

function page(
  value: unknown,
  query: Record<string, string | number>,
  length: number
): AdminPagination {
  const result = object(value);
  if (
    !result ||
    !count(result.total) ||
    result.limit !== query.limit ||
    result.offset !== query.offset ||
    length !== Math.min(query.limit as number, Math.max(0, result.total - (query.offset as number)))
  )
    return invalidResponse();
  return { total: result.total, limit: result.limit as number, offset: result.offset as number };
}
function parseUser(value: unknown): AdminUser {
  const user = object(value);
  if (
    !user ||
    !text(user.user_id, 128) ||
    typeof user.username !== 'string' ||
    typeof user.email !== 'string' ||
    !timestamp(user.created_at) ||
    typeof user.email_verified !== 'boolean' ||
    typeof user.verification_required !== 'boolean' ||
    (user.role !== 'user' && user.role !== 'admin') ||
    (user.status !== 'active' && user.status !== 'suspended') ||
    !count(user.database_count)
  )
    return invalidResponse();
  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    created_at: user.created_at,
    email_verified: user.email_verified,
    verification_required: user.verification_required,
    role: user.role,
    status: user.status,
    database_count: user.database_count,
  };
}
export function parseAdminUserResponse(
  value: unknown,
  id: string,
  status?: AccountStatus
): AdminUserResponse {
  const user = parseUser(object(value)?.user);
  if (user.user_id !== id || (status !== undefined && user.status !== status))
    return invalidResponse();
  return { user };
}
export function parseAdminUsers(
  value: unknown,
  query: Record<string, string | number>
): AdminUserListResponse {
  const result = object(value);
  if (!Array.isArray(result?.users) || result.users.length > 100) return invalidResponse();
  const users = result.users.map(parseUser);
  if (
    new Set(users.map((user) => user.user_id)).size !== users.length ||
    users.some(
      (user) =>
        (query.role !== undefined && user.role !== query.role) ||
        (query.status !== undefined && user.status !== query.status)
    )
  )
    return invalidResponse();
  return { users, pagination: page(result.pagination, query, users.length) };
}
function parseAudit(value: unknown): AdminAuditEvent {
  const event = object(value);
  if (
    !event ||
    !count(event.event_id) ||
    event.event_id === 0 ||
    !text(event.actor_user_id, 128) ||
    !text(event.target_user_id, 128) ||
    (event.action !== 'suspend' && event.action !== 'activate') ||
    !timestamp(event.created_at)
  )
    return invalidResponse();
  return {
    event_id: event.event_id,
    actor_user_id: event.actor_user_id,
    target_user_id: event.target_user_id,
    action: event.action,
    created_at: event.created_at,
  };
}
export function parseAdminAudit(
  value: unknown,
  query: Record<string, string | number>
): AdminAuditListResponse {
  const result = object(value);
  if (!Array.isArray(result?.events) || result.events.length > 100) return invalidResponse();
  const events = result.events.map(parseAudit);
  if (
    events.some(
      (event, index) =>
        (index > 0 && event.event_id >= events[index - 1].event_id) ||
        ['actor_user_id', 'target_user_id', 'action'].some(
          (key) => query[key] !== undefined && event[key as keyof AdminAuditEvent] !== query[key]
        )
    )
  )
    return invalidResponse();
  return { events, pagination: page(result.pagination, query, events.length) };
}
export function parseAccountSummary(value: unknown): AccountSummaryResponse {
  const summary = object(object(value)?.summary);
  if (
    !summary ||
    !count(summary.database_count) ||
    !count(summary.active_api_key_count) ||
    !count(summary.ready_backup_count)
  )
    return invalidResponse();
  return {
    summary: {
      database_count: summary.database_count,
      active_api_key_count: summary.active_api_key_count,
      ready_backup_count: summary.ready_backup_count,
    },
  };
}
export function parsePlatformStats(value: unknown): PlatformStatsResponse {
  const stats = object(object(value)?.stats);
  if (
    !stats ||
    !count(stats.total_users) ||
    !count(stats.total_databases) ||
    !count(stats.databases_counted) ||
    !count(stats.databases_unavailable) ||
    stats.databases_counted + stats.databases_unavailable !== stats.total_databases ||
    (stats.databases_unavailable > 0 ? stats.total_tables !== null : !count(stats.total_tables))
  )
    return invalidResponse();
  return {
    stats: {
      total_users: stats.total_users,
      total_databases: stats.total_databases,
      total_tables: stats.total_tables as number | null,
      databases_counted: stats.databases_counted,
      databases_unavailable: stats.databases_unavailable,
    },
  };
}
