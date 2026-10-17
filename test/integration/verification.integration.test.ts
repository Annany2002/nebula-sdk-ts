import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';
import { ApiError, ForbiddenError, RateLimitError } from '../../src/errors';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL && process.env.NEBULA_TEST_VERIFICATION === 'true' ? describe : describe.skip;
suite('Email verification against the isolated Go backend', () => {
  let client: NebulaClient;
  let email: string;
  const password = 'sdk-verification-password';
  async function expireCooldown(address: string) {
    const response = await fetch(`${baseURL}/__test/expire-send-cooldown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address }),
    });
    expect(response.status).toBe(204);
  }
  async function mailToken(address: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(`${baseURL}/__test/messages`);
      const messages = (await response.json()) as { to: string; body: string }[];
      const mail = [...messages]
        .reverse()
        .find((message) => message.to === address && message.body.includes('/verify-email#'));
      if (mail) {
        const match = mail.body.match(
          /http:\/\/localhost:3000\/verify-email#token=([A-Za-z0-9_-]{43})/
        );
        if (match) return match[1];
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected captured verification mail was not delivered.');
  }
  beforeAll(() => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('Verification tests require isolated loopback services.');
    client = new NebulaClient({ baseURL: baseURL! });
    email = `sdk-verification-${randomUUID()}@example.test`;
  });

  it('creates a pending account, blocks login, confirms once, and exposes status', async () => {
    const signup = await client.auth.signup({ username: 'sdk_builder', email, password });
    expect(signup).toMatchObject({ verification_required: true, verification_delivery: 'sent' });
    expect(client.getAuthToken()).toBeNull();
    await expect(client.auth.login({ email, password })).rejects.toMatchObject({
      statusCode: 403,
      errorData: { code: 'email_verification_required' },
    });
    const token = await mailToken(email);
    await client.auth.verifyEmail(token);
    const login = await client.auth.login({ email, password });
    client.setAuthToken(login.token);
    await expect(client.auth.getMe()).resolves.toMatchObject({
      email,
      email_verified: true,
      verification_required: true,
    });
    await expect(client.auth.verifyEmail(token)).rejects.toMatchObject({
      statusCode: 400,
      errorData: { code: 'invalid_verification_token' },
    });
    expect(client.getAuthToken()).toBe(login.token);
  });

  it('requires the password; retains the current email until confirmation and then revokes old JWTs', async () => {
    const next = `sdk-changed-${randomUUID()}@example.test`;
    await expect(
      client.auth.requestEmailChange({ email: next, current_password: 'wrong-password' })
    ).rejects.toMatchObject({ statusCode: 401, errorData: { code: 'reauthentication_required' } });
    // A fresh verified fixture has the signup send cooldown. Confirm this budget survives
    // requests rather than sleeping or weakening the server limiter for this test.
    const rate = await client.auth
      .requestEmailChange({ email: next, current_password: password })
      .catch((error) => error);
    expect(rate).toBeInstanceOf(RateLimitError);
    expect(rate.retryAfterSeconds).toBeGreaterThan(0);
    expect((await client.auth.getMe()).email).toBe(email);
    await client.databases.create({ db_name: 'verification_data' });
    const key = await client.databases.createApiKey('verification_data');
    const application = new NebulaClient({ baseURL: baseURL!, apiKey: key.api_key });
    await expireCooldown(email);
    const pending = await client.auth.requestEmailChange({
      email: next,
      current_password: password,
    });
    expect(pending).toHaveProperty('pending_email', next);
    expect(pending).not.toHaveProperty('user');
    await expect(client.auth.getMe()).resolves.toMatchObject({ email, pending_email: next });
    await client.auth.verifyEmail(await mailToken(next));
    await expect(client.auth.getMe()).rejects.toMatchObject({
      statusCode: 401,
      errorData: { code: 'session_revoked' },
    });
    await expect(application.auth.healthP()).resolves.toMatchObject({
      authenticated_by: 'api_key',
      status: 'ok',
    });
    client.setAuthToken(null);
    const login = await client.auth.login({ email: next, password });
    client.setAuthToken(login.token);
    email = next;
    await expect(client.auth.getMe()).resolves.toMatchObject({ email, email_verified: true });
  });

  it('resend gives the same generic acknowledgement for unknown and verified addresses', async () => {
    const unknown = await client.auth.resendVerification(`unknown-${randomUUID()}@example.test`);
    const verified = await client.auth.resendVerification(email);
    expect(unknown).toEqual(verified);
  });

  it('recovers from failed signup delivery by resending after the persistent cooldown', async () => {
    const failedEmail = `sdk-failed-${randomUUID()}@example.test`;
    await fetch(`${baseURL}/__test/mail-failure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ failure: true }),
    });
    try {
      await expect(
        client.auth.signup({ username: 'sdk_failure', email: failedEmail, password })
      ).resolves.toMatchObject({
        verification_required: true,
        verification_delivery: 'unconfirmed',
      });
    } finally {
      await fetch(`${baseURL}/__test/mail-failure`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failure: false }),
      });
    }
    await expect(client.auth.login({ email: failedEmail, password })).rejects.toBeInstanceOf(
      ForbiddenError
    );
    await expect(client.auth.resendVerification(failedEmail)).resolves.toHaveProperty('message');
    await expireCooldown(failedEmail);
    await client.auth.resendVerification(failedEmail);
    await client.auth.verifyEmail(await mailToken(failedEmail));
    await expect(client.auth.login({ email: failedEmail, password })).resolves.toHaveProperty(
      'token'
    );
    await expect(client.auth.verifyEmail('B'.repeat(43))).rejects.toBeInstanceOf(ApiError);
  });
});
