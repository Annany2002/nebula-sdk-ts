import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL && process.env.NEBULA_TEST_RECOVERY === 'true' ? describe : describe.skip;
suite('Password recovery against the isolated Go backend', () => {
  let client: NebulaClient;
  const password = 'sdk-original-password';
  async function tokenFor(email: string, path: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(`${baseURL}/__test/messages`);
      const messages = (await response.json()) as { to: string; body: string }[];
      const message = [...messages]
        .reverse()
        .find((message) => message.to === email && message.body.includes(`/${path}#token=`));
      const match = message?.body.match(new RegExp(`/${path}#token=([A-Za-z0-9_-]{43})`));
      if (match) return match[1];
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected account email was not captured.');
  }
  async function expireCooldown(email: string) {
    const response = await fetch(`${baseURL}/__test/expire-send-cooldown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(response.status).toBe(204);
  }
  beforeAll(() => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('Recovery integration requires isolated loopback services.');
    client = new NebulaClient({ baseURL: baseURL! });
  });
  it('requests generically, resets once and revokes the previous JWT without changing client state', async () => {
    const email = `sdk-recovery-${randomUUID()}@example.test`;
    await client.auth.signup({ username: 'sdk_builder', email, password });
    await client.auth.verifyEmail(await tokenFor(email, 'verify-email'));
    const login = await client.auth.login({ email, password });
    client.setAuthToken(login.token);
    await expireCooldown(email);
    const known = await client.auth.forgotPassword(email);
    const unknown = await client.auth.forgotPassword(`missing-${randomUUID()}@example.test`);
    expect(known).toEqual(unknown);
    const token = await tokenFor(email, 'reset-password');
    await expect(client.auth.getMe()).resolves.toMatchObject({ email });
    await expect(
      client.auth.resetPassword({ token, password: 'sdk-replaced-password' })
    ).resolves.toHaveProperty('message');
    expect(client.getAuthToken()).toBe(login.token);
    await expect(client.auth.getMe()).rejects.toMatchObject({
      statusCode: 401,
      errorData: { code: 'session_revoked' },
    });
    await expect(
      client.auth.resetPassword({ token, password: 'sdk-attacker-password' })
    ).rejects.toMatchObject({
      statusCode: 400,
      errorData: { code: 'invalid_password_reset_token' },
    });
    await expect(client.auth.login({ email, password })).rejects.toMatchObject({ statusCode: 401 });
    client.setAuthToken(
      (await client.auth.login({ email, password: 'sdk-replaced-password' })).token
    );
    await expect(client.auth.getMe()).resolves.toMatchObject({ email, email_verified: true });
  });
  it('does not use password recovery to bypass pending email verification', async () => {
    const email = `sdk-pending-${randomUUID()}@example.test`;
    await client.auth.signup({ username: 'sdk_pending', email, password });
    await expireCooldown(email);
    await client.auth.forgotPassword(email);
    await client.auth.resetPassword({
      token: await tokenFor(email, 'reset-password'),
      password: 'sdk-new-pending-password',
    });
    await expect(
      client.auth.login({ email, password: 'sdk-new-pending-password' })
    ).rejects.toMatchObject({
      statusCode: 403,
      errorData: { code: 'email_verification_required' },
    });
  });
});
