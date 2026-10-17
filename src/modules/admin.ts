import { makeRequest } from '../http';
import {
  AccountStatus,
  AdminAuditListOptions,
  AdminAuditListResponse,
  AdminUserListOptions,
  AdminUserListResponse,
  AdminUserResponse,
  ManagementRequestOptions,
  PlatformStatsResponse,
} from '../types';
import { bearerContext, ModuleContext } from './_common';
import {
  adminQuery,
  parseAdminAudit,
  parseAdminUsers,
  parseAdminUserResponse,
  parsePlatformStats,
  validateAccountID,
} from './management-validation';

/** Platform membership is enforced by the server on every request. No operation retries. */
export class AdminModule {
  constructor(private readonly context: ModuleContext) {}

  async listUsers(
    filters: AdminUserListOptions = {},
    options: ManagementRequestOptions = {}
  ): Promise<AdminUserListResponse> {
    const query = adminQuery(filters, 'users');
    return makeRequest(
      'api/v1/admin/users',
      'GET',
      bearerContext(this.context, options),
      query,
      undefined,
      [200],
      (value) => parseAdminUsers(value, query)
    );
  }

  async getUser(id: string, options: ManagementRequestOptions = {}): Promise<AdminUserResponse> {
    validateAccountID(id);
    return makeRequest(
      `api/v1/admin/users/${encodeURIComponent(id)}`,
      'GET',
      bearerContext(this.context, options),
      undefined,
      undefined,
      [200],
      (value) => parseAdminUserResponse(value, id)
    );
  }

  async getStats(options: ManagementRequestOptions = {}): Promise<PlatformStatsResponse> {
    return makeRequest(
      'api/v1/admin/stats',
      'GET',
      bearerContext(this.context, options),
      undefined,
      undefined,
      [200],
      parsePlatformStats
    );
  }

  /** Revokes existing JWT sessions and blocks API keys while preserving data. Admin targets are protected. */
  async suspendUser(
    id: string,
    options: ManagementRequestOptions = {}
  ): Promise<AdminUserResponse> {
    return this.setStatus(id, 'suspended', options);
  }

  /** Requires a fresh JWT login afterward. Existing API keys resume within their original scope. */
  async activateUser(
    id: string,
    options: ManagementRequestOptions = {}
  ): Promise<AdminUserResponse> {
    return this.setStatus(id, 'active', options);
  }

  async listAuditEvents(
    filters: AdminAuditListOptions = {},
    options: ManagementRequestOptions = {}
  ): Promise<AdminAuditListResponse> {
    const query = adminQuery(filters, 'audit');
    return makeRequest(
      'api/v1/admin/audit-events',
      'GET',
      bearerContext(this.context, options),
      query,
      undefined,
      [200],
      (value) => parseAdminAudit(value, query)
    );
  }

  private async setStatus(
    id: string,
    status: AccountStatus,
    options: ManagementRequestOptions
  ): Promise<AdminUserResponse> {
    validateAccountID(id);
    const action = status === 'suspended' ? 'suspend' : 'activate';
    return makeRequest(
      `api/v1/admin/users/${encodeURIComponent(id)}/${action}`,
      'PUT',
      bearerContext(this.context, options),
      undefined,
      undefined,
      [200],
      (value) => parseAdminUserResponse(value, id, status)
    );
  }
}
