import {
  ApiError,
  AuthError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
  RequestAbortedError,
  ServerError,
  TimeoutError,
} from '../../src/errors';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const token = 'A'.repeat(43);
const email = 'owner@example.test';
const user = { userId: 'owner', username: 'builder', email, createdAt: '2026-10-17T00:00:00Z' };

describe('Email verification contracts', () => {
  const { client, mockFetch } = createTestClient();
  beforeEach(() => {
    mockFetch.mockReset();
    client.setAuthToken('existing.jwt');
  });

  it.each(['sent', 'unconfirmed'] as const)(
    'signup preserves pending delivery %s without creating a session',
    async (delivery) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(201, {
          message: 'Created',
          user_id: 'owner',
          verification_required: true,
          verification_delivery: delivery,
          token: 'must-not-return',
        })
      );
      const result = await client.auth.signup({
        email,
        username: 'builder',
        password: 'test-password',
      });
      expect(result).toEqual({
        message: 'Created',
        user_id: 'owner',
        verification_required: true,
        verification_delivery: delivery,
      });
      expect(client.getAuthToken()).toBe('existing.jwt');
      expect(getLastRequest(mockFetch).headers.Authorization).toBeUndefined();
    }
  );

  it.each([
    { message: 'Created', user_id: 'owner', verification_required: true },
    {
      message: 'Created',
      user_id: 'owner',
      verification_required: 'true',
      verification_delivery: 'sent',
    },
    {
      message: 'Created',
      user_id: 'owner',
      verification_required: false,
      verification_delivery: 'sent',
    },
    {
      message: 'Created',
      user_id: 'owner',
      verification_required: true,
      verification_delivery: 'unknown',
    },
  ])('rejects inconsistent signup acknowledgement %#', async (body) => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, body));
    await expect(
      client.auth.signup({ email, username: 'builder', password: 'test-password' })
    ).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the verification-required login code and existing session', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(403, { error: 'Verify first', code: 'email_verification_required' })
    );
    await expect(client.auth.login({ email, password: 'test-password' })).rejects.toMatchObject({
      statusCode: 403,
      errorData: { code: 'email_verification_required' },
    });
    expect(client.getAuthToken()).toBe('existing.jwt');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each(['confirm', 'resend'] as const)(
    '%s is public, body-only, non-caching and does not change the stored JWT',
    async (action) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(action === 'confirm' ? 200 : 202, {
          message: 'Acknowledged',
          token: 'must-not-return',
        })
      );
      const result =
        action === 'confirm'
          ? await client.auth.verifyEmail(token)
          : await client.auth.resendVerification(email);
      expect(result).toEqual({ message: 'Acknowledged' });
      const req = getLastRequest(mockFetch);
      expect(req.url).toBe(
        'http://api.nebula-test.com/auth/' +
          (action === 'confirm' ? 'verify-email' : 'resend-verification')
      );
      expect(req.body).toEqual(action === 'confirm' ? { token } : { email });
      expect(req.headers.Authorization).toBeUndefined();
      expect(mockFetch.mock.calls[0][1]).toMatchObject({
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(client.getAuthToken()).toBe('existing.jwt');
    }
  );

  it.each([
    '',
    'A'.repeat(42),
    'A'.repeat(44),
    '<token>',
    'http://app.test/verify-email#token=' + token,
  ])('rejects malformed tokens without sending them: %#', async (value) => {
    await expect(client.auth.verifyEmail(value)).rejects.toThrow('verification token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'missing-at',
    'owner\r\n@example.test',
    'öwner@example.test',
    'a'.repeat(254) + '@x',
  ])('rejects unsafe email input before fetch: %#', async (value) => {
    await expect(client.auth.resendVerification(value)).rejects.toThrow('email address');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [201, { message: 'Wrong status' }],
    [200, {}],
    [204, null],
  ] as const)('rejects unconfirmed verification replies %#', async (status, body) => {
    mockFetch.mockResolvedValueOnce(mockResponse(status, body));
    await expect(client.auth.verifyEmail(token)).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('resend requires a 202 acknowledgement', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'Not accepted' }));
    await expect(client.auth.resendVerification(email)).rejects.toBeInstanceOf(NetworkError);
  });

  it.each([
    [400, 'invalid_verification_token', ApiError],
    [409, 'email_conflict', ApiError],
    [503, 'verification_disabled', ServerError],
    [503, 'verification_busy', ServerError],
    [404, undefined, ApiError],
  ] as const)(
    'preserves server errors without retrying: %s %s',
    async (status, code, errorType) => {
      mockFetch.mockResolvedValueOnce(mockResponse(status, { error: 'Rejected', code }));
      const error = await client.auth.verifyEmail(token).catch((failure) => failure);
      expect(error).toBeInstanceOf(errorType);
      expect(error.errorData.code).toBe(code);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );

  it('returns pending_email while preserving the existing address and JWT', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(202, { message: 'Confirm new address', pending_email: 'new@example.test' })
    );
    const result = await client.auth.requestEmailChange({
      email: 'new@example.test',
      current_password: 'current-password',
    });
    expect(result).toEqual({ message: 'Confirm new address', pending_email: 'new@example.test' });
    expect(getLastRequest(mockFetch)).toMatchObject({
      method: 'PUT',
      headers: { Authorization: 'Bearer existing.jwt' },
      body: { email: 'new@example.test', current_password: 'current-password' },
    });
    expect(client.getAuthToken()).toBe('existing.jwt');
  });

  it('supports immediate email changes and combined updates on legacy servers', async () => {
    const updated = { ...user, email: 'new@example.test' };
    mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'Updated', user: updated }));
    await expect(
      client.auth.updateProfile({ username: 'builder', email: updated.email })
    ).resolves.toEqual({ message: 'Updated', user: updated });
  });

  it('exposes optional profile verification fields without inventing proof for legacy accounts', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, user));
    expect((await client.auth.getMe()).email_verified).toBeUndefined();
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        ...user,
        email_verified: false,
        verification_required: false,
        pending_email: 'new@example.test',
      })
    );
    await expect(client.auth.getMe()).resolves.toMatchObject({
      email_verified: false,
      verification_required: false,
      pending_email: 'new@example.test',
    });
  });

  it.each([
    [202, { message: 'Pending', pending_email: 'other@example.test' }],
    [202, { message: 'Pending', pending_email: 'new@example.test', user }],
    [200, { message: 'Pending', pending_email: 'new@example.test' }],
    [200, { message: 'Updated', user }],
    [
      200,
      { message: 'Updated', user: { ...user, email: 'new@example.test', email_verified: 'yes' } },
    ],
  ] as const)('rejects inconsistent email-change results %#', async (status, body) => {
    mockFetch.mockResolvedValueOnce(mockResponse(status, body));
    await expect(
      client.auth.requestEmailChange({
        email: 'new@example.test',
        current_password: 'current-password',
      })
    ).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not accept 202 for a username-only update', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(202, { message: 'Pending', pending_email: email })
    );
    await expect(client.auth.updateProfile({ username: 'builder' })).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('requires a JWT for email changes, never substituting the API key', async () => {
    client.setAuthToken(null);
    await expect(
      client.auth.requestEmailChange({ email, current_password: 'current-password' })
    ).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['', 'é'.repeat(37)])(
    'validates the current password without reflecting it: %#',
    async (password) => {
      await expect(
        client.auth.requestEmailChange({ email, current_password: password })
      ).rejects.toThrow('current password');
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it('preserves reauthentication and revoked-session error codes', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(401, { error: 'Confirm password', code: 'reauthentication_required' })
    );
    await expect(
      client.auth.requestEmailChange({ email, current_password: 'wrong-password' })
    ).rejects.toMatchObject({ errorData: { code: 'reauthentication_required' } });
    mockFetch.mockResolvedValueOnce(
      mockResponse(401, { error: 'Sign in again', code: 'session_revoked' })
    );
    await expect(client.auth.getMe()).rejects.toMatchObject({
      errorData: { code: 'session_revoked' },
    });
  });

  it.each([
    '900',
    ' 60 ',
    '0',
    new Date(Date.now() + 60000).toUTCString(),
    '-1',
    '1.5',
    'NaN',
    '999999999999999999999',
  ])('handles Retry-After %s without retrying', async (header) => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        429,
        { error: 'Wait', code: 'verification_rate_limited' },
        { 'Retry-After': header }
      )
    );
    const error = await client.auth.resendVerification(email).catch((failure) => failure);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.errorData.code).toBe('verification_rate_limited');
    if (['900', ' 60 ', '0'].includes(header)) expect(error.retryAfterSeconds).toBe(Number(header));
    else if (header.includes('GMT')) expect(error.retryAfterSeconds).toBeGreaterThan(0);
    else expect(error.retryAfterSeconds).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('supports cancellation before sending and a bounded deadline without replay', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.auth.verifyEmail(token, { signal: controller.signal })
    ).rejects.toBeInstanceOf(RequestAbortedError);
    expect(mockFetch).not.toHaveBeenCalled();
    mockFetch.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('stopped')), {
            once: true,
          })
        )
    );
    await expect(client.auth.verifyEmail(token, { timeout: 15 })).rejects.toBeInstanceOf(
      TimeoutError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { timeout: 0 },
    { timeout: NaN },
    { timeout: 2147483648 },
    { signal: {} },
    { apiKey: 'override' },
  ])('rejects invalid per-request options %#', async (options) => {
    await expect(client.auth.verifyEmail(token, options as never)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not retry or replace the JWT after a protected verification failure', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(403, { error: 'Verify first', code: 'email_verification_required' })
    );
    await expect(client.auth.getMe()).rejects.toBeInstanceOf(ForbiddenError);
    expect(client.getAuthToken()).toBe('existing.jwt');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
