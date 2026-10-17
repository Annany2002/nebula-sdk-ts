import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, relative, resolve, sep } from 'node:path';
import { NebulaClient } from '../../src/client';
import { AuthError, ConflictError, ForbiddenError } from '../../src/errors';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL && process.env.NEBULA_TEST_MANAGEMENT === 'true' ? describe : describe.skip;

suite('Management contracts against an isolated Go backend', () => {
  const password = 'sdk-management-fixture-password';
  const email = `sdk-member-${randomUUID()}@example.test`;
  let admin: NebulaClient;
  let member: NebulaClient;
  let application: NebulaClient;
  let adminId: string;
  let memberId: string;
  let cli: string;
  let metadata: string;
  let token: string;
  const database = 'sdk_management';

  function membership(enabled: boolean) {
    execFileSync(
      cli,
      ['--metadata-db', metadata, '--user-id', adminId, enabled ? 'grant' : 'revoke'],
      { stdio: 'pipe' }
    );
  }
  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('Management integration requires an isolated loopback backend.');
    const root = realpathSync(process.env.NEBULA_TEST_ROOT!);
    cli = realpathSync(process.env.NEBULA_TEST_ADMIN_CLI!);
    metadata = realpathSync(process.env.NEBULA_TEST_METADATA!);
    if (
      !basename(root).startsWith('nebula-sdk-contracts-') ||
      resolve(root, '..') !== realpathSync(tmpdir()) ||
      [cli, metadata].some(
        (path) => relative(root, path).startsWith('..') || !path.startsWith(root + sep)
      )
    )
      throw new Error('Operator CLI access is restricted to disposable integration-test files.');
    admin = new NebulaClient({ baseURL: baseURL! });
    member = new NebulaClient({ baseURL: baseURL! });
    const adminEmail = `sdk-admin-${randomUUID()}@example.test`;
    await admin.auth.signup({ username: 'sdk_operator', email: adminEmail, password });
    const adminLogin = await admin.auth.login({ email: adminEmail, password });
    adminId = adminLogin.user.userId;
    admin.setAuthToken(adminLogin.token);
    membership(true);
    await member.auth.signup({ username: 'sdk_member', email, password });
    const login = await member.auth.login({ email, password });
    memberId = login.user.userId;
    token = login.token;
    member.setAuthToken(token);
    await member.databases.create({ db_name: database });
    const key = await member.databases.createApiKey(database);
    application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await application.schema.define(database, {
      table_name: 'items',
      columns: [{ name: 'label', type: 'TEXT' }],
    });
    await member.backups.create(database, { backup_id: randomUUID() });
  }, 20000);

  it('reads current membership and owner-scoped counts, including for administrators', async () => {
    await expect(admin.auth.getMe()).resolves.toMatchObject({ userId: adminId, role: 'admin' });
    await expect(member.auth.getMe()).resolves.toMatchObject({ userId: memberId, role: 'user' });
    await expect(member.account.getSummary()).resolves.toEqual({
      summary: { database_count: 1, active_api_key_count: 1, ready_backup_count: 1 },
    });
    await expect(admin.account.getSummary()).resolves.toEqual({
      summary: { database_count: 0, active_api_key_count: 0, ready_backup_count: 0 },
    });
  });
  it('blocks ordinary JWTs and database keys from platform administration', async () => {
    await expect(member.admin.listUsers()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(application.admin.getStats()).rejects.toBeInstanceOf(AuthError);
    await expect(application.account.getSummary()).rejects.toBeInstanceOf(AuthError);
  });
  it('combines user filters and paginates matching metadata', async () => {
    await expect(
      admin.admin.listUsers({ q: 'SDK_MEMBER', role: 'user', status: 'active', limit: 1 })
    ).resolves.toMatchObject({
      users: [{ user_id: memberId }],
      pagination: { total: 1, limit: 1, offset: 0 },
    });
    await expect(admin.admin.listUsers({ q: '%', limit: 1 })).resolves.toMatchObject({
      users: [],
      pagination: { total: 0 },
    });
    await expect(admin.admin.listUsers({ role: 'user', offset: 1 })).resolves.toMatchObject({
      users: [],
      pagination: { total: 1, offset: 1 },
    });
    await expect(admin.admin.getUser(memberId)).resolves.toMatchObject({
      user: { user_id: memberId, status: 'active', database_count: 1 },
    });
    await expect(admin.admin.getStats()).resolves.toEqual({
      stats: {
        total_users: 2,
        total_databases: 1,
        total_tables: 1,
        databases_counted: 1,
        databases_unavailable: 0,
      },
    });
  });
  it('suspends idempotently, blocks existing access and records one actual transition', async () => {
    await expect(admin.admin.suspendUser(memberId)).resolves.toMatchObject({
      user: { user_id: memberId, status: 'suspended' },
    });
    await expect(admin.admin.suspendUser(memberId)).resolves.toHaveProperty(
      'user.status',
      'suspended'
    );
    await expect(member.auth.login({ email, password })).rejects.toMatchObject({
      statusCode: 403,
      errorData: { code: 'account_suspended' },
    });
    await expect(member.account.getSummary()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(application.schema.listTables(database)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      admin.admin.listAuditEvents({
        actor_user_id: adminId,
        target_user_id: memberId,
        action: 'suspend',
      })
    ).resolves.toMatchObject({
      events: [{ actor_user_id: adminId, target_user_id: memberId, action: 'suspend' }],
      pagination: { total: 1 },
    });
  });
  it('activation preserves API keys, but revoked JWTs require a fresh login', async () => {
    await expect(admin.admin.activateUser(memberId)).resolves.toHaveProperty(
      'user.status',
      'active'
    );
    await expect(admin.admin.activateUser(memberId)).resolves.toHaveProperty(
      'user.status',
      'active'
    );
    await expect(member.account.getSummary()).rejects.toMatchObject({
      statusCode: 401,
      errorData: { code: 'session_revoked' },
    });
    expect(member.getAuthToken()).toBe(token);
    member.setAuthToken((await member.auth.login({ email, password })).token);
    await expect(member.account.getSummary()).resolves.toHaveProperty(
      'summary.active_api_key_count',
      1
    );
    await expect(application.schema.listTables(database)).resolves.toMatchObject({
      tables: [{ name: 'items' }],
    });
    const audit = await admin.admin.listAuditEvents({ target_user_id: memberId });
    expect(audit.pagination.total).toBe(2);
    expect(audit.events.map((event) => event.action)).toEqual(['activate', 'suspend']);
  });
  it('preserves the protected-administrator conflict and code', async () => {
    const failure = await admin.admin.suspendUser(adminId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect(failure).toMatchObject({ errorData: { code: 'admin_account_protected' } });
  });
  it('counts retained ready backups after the source and its API key are deleted', async () => {
    await member.databases.delete(database);
    await expect(member.account.getSummary()).resolves.toEqual({
      summary: { database_count: 0, active_api_key_count: 0, ready_backup_count: 1 },
    });
  });
  it('revocation applies to the same JWT without modifying its stored token', async () => {
    const current = admin.getAuthToken();
    membership(false);
    await expect(admin.auth.getMe()).resolves.toHaveProperty('role', 'user');
    await expect(admin.admin.listUsers()).rejects.toMatchObject({
      statusCode: 403,
      errorData: { code: 'admin_required' },
    });
    expect(admin.getAuthToken()).toBe(current);
  });
});
