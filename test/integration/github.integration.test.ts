import { createHash, randomBytes } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { GitHubCallbackPayload } from '../../src/types';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL && process.env.NEBULA_TEST_GITHUB === 'true' ? describe : describe.skip;
suite('GitHub OAuth against the isolated Go backend', () => {
  let client: NebulaClient;
  let githubUserId: string;
  let owner: NebulaClient;
  let ownerToken: string;
  let ownerId: string;
  let dataClient: NebulaClient;
  const password = 'sdk-owner-password';
  const email = 'sdk-owner@example.test';
  async function start(code = 'new', linking = false): Promise<GitHubCallbackPayload> {
    const code_verifier = randomBytes(32).toString('base64url');
    const code_challenge = createHash('sha256').update(code_verifier).digest('base64url');
    const result = linking
      ? await owner.auth.startGitHubLink({ code_challenge, current_password: password })
      : await client.auth.startGitHubSignIn({ code_challenge });
    const target = new URL(result.authorization_url);
    expect(target.origin).toBe('https://github.com');
    expect(target.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/github/callback'
    );
    expect(result.expires_in).toBe(600);
    return { code, state: target.searchParams.get('state')!, code_verifier };
  }
  async function providerCalls() {
    const response = await fetch(`${baseURL}/__test/provider-calls`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { calls: number }).calls;
  }
  beforeAll(() => {
    const target = new URL(baseURL!);
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1')
      throw new Error('OAuth integration requires an isolated loopback backend.');
    client = new NebulaClient({ baseURL: baseURL! });
    client.setAuthToken('unrelated-existing-session');
  });
  it('advertises password and enabled GitHub authentication without a JWT', async () => {
    await expect(client.auth.getProviders()).resolves.toEqual({
      providers: { password: true, github: true },
    });
  });
  it('creates a verified passwordless account and leaves JWT adoption to the caller', async () => {
    const result = await client.auth.completeGitHubSignIn(await start());
    expect(result.user).toMatchObject({ email: 'github-new@example.test', email_verified: true });
    expect(result.token).toBeTruthy();
    expect(client.getAuthToken()).toBe('unrelated-existing-session');
    githubUserId = result.user.userId;
    client.setAuthToken(result.token);
    await expect(client.auth.getMe()).resolves.toMatchObject({
      userId: githubUserId,
      role: 'user',
    });
    await expect(
      client.auth.login({ email: result.user.email, password: 'not-a-real-password' })
    ).rejects.toMatchObject({ statusCode: 401 });
  });
  it('consumes an exchange once and resolves returning GitHub identities to the same account', async () => {
    const callback = await start();
    const before = await providerCalls();
    const result = await client.auth.completeGitHubSignIn(callback);
    expect(result.user.userId).toBe(githubUserId);
    await expect(client.auth.completeGitHubSignIn(callback)).rejects.toMatchObject({
      statusCode: 400,
      errorData: { code: 'invalid_github_oauth_state' },
    });
    expect(await providerCalls()).toBe(before + 1);
  });
  it('rejects a wrongly bound proof before provider work, without consuming the valid attempt', async () => {
    const callback = await start();
    const before = await providerCalls();
    await expect(
      client.auth.completeGitHubSignIn({ ...callback, code_verifier: 'z'.repeat(43) })
    ).rejects.toMatchObject({ statusCode: 400, errorData: { code: 'invalid_github_oauth_state' } });
    expect(await providerCalls()).toBe(before);
    await expect(client.auth.completeGitHubSignIn(callback)).resolves.toMatchObject({
      user: { userId: githubUserId },
    });
  });
  it('never merges an existing password account by email', async () => {
    owner = new NebulaClient({ baseURL: baseURL! });
    await owner.auth.signup({ username: 'sdk_owner', email, password });
    const login = await owner.auth.login({ email, password });
    ownerToken = login.token;
    ownerId = login.user.userId;
    owner.setAuthToken(ownerToken);
    await expect(
      client.auth.completeGitHubSignIn(await start('existing-email'))
    ).rejects.toMatchObject({ statusCode: 409, errorData: { code: 'github_account_conflict' } });
    await expect(owner.auth.getMe()).resolves.toMatchObject({ userId: ownerId });
  });
  it('requires reauthentication before creating a linking transaction', async () => {
    const code_challenge = createHash('sha256').update('x'.repeat(43)).digest('base64url');
    await expect(
      owner.auth.startGitHubLink({ code_challenge, current_password: 'wrong-password' })
    ).rejects.toMatchObject({ statusCode: 401, errorData: { code: 'reauthentication_required' } });
    await expect(owner.auth.getMe()).resolves.toMatchObject({ userId: ownerId });
  });
  it('links explicitly, revokes the old JWT and preserves database API keys and password access', async () => {
    await owner.databases.create({ db_name: 'sdk_oauth_data' });
    const key = await owner.databases.createApiKey('sdk_oauth_data');
    dataClient = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await dataClient.schema.define('sdk_oauth_data', {
      table_name: 'items',
      columns: [{ name: 'label', type: 'TEXT' }],
    });
    await expect(
      owner.auth.completeGitHubLink(await start('existing-email', true))
    ).resolves.toEqual({ message: 'GitHub linked. Sign in again to continue.' });
    expect(owner.getAuthToken()).toBe(ownerToken);
    await expect(owner.auth.getMe()).rejects.toMatchObject({ statusCode: 401 });
    await expect(dataClient.schema.listTables('sdk_oauth_data')).resolves.toMatchObject({
      tables: [expect.objectContaining({ name: 'items' })],
    });
    owner.setAuthToken(null);
    const login = await client.auth.completeGitHubSignIn(await start('existing-email'));
    expect(login.user.userId).toBe(ownerId);
    owner.setAuthToken(login.token);
    await expect(owner.auth.getMe()).resolves.toMatchObject({ userId: ownerId, email });
    await expect(owner.auth.login({ email, password })).resolves.toMatchObject({
      user: { userId: ownerId },
    });
  });
  it('refuses replacing an already-linked identity', async () => {
    await expect(owner.auth.completeGitHubLink(await start('new', true))).rejects.toMatchObject({
      statusCode: 409,
      errorData: { code: 'github_account_conflict' },
    });
    await expect(owner.auth.getMe()).resolves.toMatchObject({ userId: ownerId });
  });
  it.each([
    ['unverified', 403, 'github_verified_email_required'],
    ['unavailable', 503, 'github_oauth_unavailable'],
  ] as const)(
    'maps %s provider failures and never replays a consumed code',
    async (code, statusCode, machineCode) => {
      const callback = await start(code);
      const before = await providerCalls();
      await expect(client.auth.completeGitHubSignIn(callback)).rejects.toMatchObject({
        statusCode,
        errorData: { code: machineCode },
      });
      await expect(client.auth.completeGitHubSignIn(callback)).rejects.toMatchObject({
        statusCode: 400,
        errorData: { code: 'invalid_github_oauth_state' },
      });
      expect(await providerCalls()).toBe(before + 1);
    }
  );
});
