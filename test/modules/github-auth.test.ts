import { createHash } from 'node:crypto';
import { AuthError, NetworkError, RequestAbortedError, TimeoutError } from '../../src/errors';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const verifier = 'x'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = 'A'.repeat(43);
const callback = { code: 'temporary-code', state, code_verifier: verifier };
const user = {
  userId: 'owner',
  username: 'builder',
  email: 'builder@example.test',
  createdAt: '2026-10-18T00:00:00Z',
};
function authorization(overrides: Partial<Record<string, string>> = {}) {
  const params = new URLSearchParams({
    client_id: 'fixture-client',
    redirect_uri: 'http://localhost:3000/auth/github/callback',
    scope: 'user:email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  for (const [name, value] of Object.entries(overrides))
    if (value !== undefined) params.set(name, value);
  return 'https://github.com/login/oauth/authorize?' + params;
}

const response = () => ({ authorization_url: authorization(), expires_in: 600 });

describe('GitHub authentication contracts', () => {
  const { client, mockFetch } = createTestClient();
  beforeEach(() => {
    mockFetch.mockReset();
    client.setAuthToken('existing.jwt');
  });

  it('discovers providers without credentials or unexpected metadata', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        providers: { password: true, github: false },
        client_secret: 'must-not-escape',
      })
    );
    await expect(client.auth.getProviders()).resolves.toEqual({
      providers: { password: true, github: false },
    });
    expect(getLastRequest(mockFetch)).toEqual({
      url: 'http://api.nebula-test.com/auth/providers',
      method: 'GET',
      headers: { Accept: 'application/json' },
      body: undefined,
    });
    expect(mockFetch.mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    expect(client.getAuthToken()).toBe('existing.jwt');
  });
  it.each(['sign-in', 'link'] as const)(
    'starts %s with body-only proof and the correct authentication',
    async (mode) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, { ...response(), client_secret: 'must-not-escape' })
      );
      const result =
        mode === 'link'
          ? await client.auth.startGitHubLink({
              code_challenge: challenge,
              current_password: 'fixture-password',
            })
          : await client.auth.startGitHubSignIn({ code_challenge: challenge });
      expect(result).toEqual(response());
      const request = getLastRequest(mockFetch);
      expect(request.url).toBe(
        'http://api.nebula-test.com/' +
          (mode === 'link' ? 'api/v1/account/identities/github/start' : 'auth/github/start')
      );
      expect(request.method).toBe('POST');
      expect(request.headers.Authorization).toBe(
        mode === 'link' ? 'Bearer existing.jwt' : undefined
      );
      expect(request.body).toEqual({
        code_challenge: challenge,
        ...(mode === 'link' && { current_password: 'fixture-password' }),
      });
      expect(mockFetch.mock.calls[0][1]).toMatchObject({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      expect(client.getAuthToken()).toBe('existing.jwt');
    }
  );
  it.each(['sign-in', 'link'] as const)(
    'completes %s without sending or replacing the stored JWT',
    async (mode) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          mode === 'link'
            ? { message: 'Linked', provider_access_token: 'must-not-escape' }
            : {
                message: 'Logged in',
                token: 'new.jwt',
                user: { ...user, password_hash: 'must-not-escape' },
                access_token: 'must-not-escape',
              }
        )
      );
      const result =
        mode === 'link'
          ? await client.auth.completeGitHubLink(callback)
          : await client.auth.completeGitHubSignIn(callback);
      expect(result).toEqual(
        mode === 'link' ? { message: 'Linked' } : { message: 'Logged in', token: 'new.jwt', user }
      );
      const request = getLastRequest(mockFetch);
      expect(request.url).toBe('http://api.nebula-test.com/auth/github/callback');
      expect(request.headers.Authorization).toBeUndefined();
      expect(request.body).toEqual(callback);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(client.getAuthToken()).toBe('existing.jwt');
    }
  );
  it.each(['\n', '\r', '\r\n', '\u2028', '\u2029'])(
    'rejects trailing line terminators across every OAuth proof field %#',
    async (ending) => {
      for (const field of ['code', 'state', 'code_verifier']) {
        await expect(
          client.auth.completeGitHubSignIn({
            ...callback,
            [field]: callback[field as keyof typeof callback] + ending,
          })
        ).rejects.toThrow();
      }
      await expect(
        client.auth.startGitHubSignIn({ code_challenge: challenge + ending })
      ).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, {
          authorization_url: authorization({ state: state + ending }),
          expires_in: 600,
        })
      );
      await expect(
        client.auth.startGitHubSignIn({ code_challenge: challenge })
      ).rejects.toBeInstanceOf(NetworkError);
    }
  );
  it('never substitutes an API key for the owner JWT while linking', async () => {
    client.setAuthToken(null);
    await expect(
      client.auth.startGitHubLink({
        code_challenge: challenge,
        current_password: 'fixture-password',
      })
    ).rejects.toBeInstanceOf(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { code_challenge: 'B'.repeat(43) },
    { code_challenge: challenge, redirect_uri: 'https://evil.test' },
    { code_challenge: challenge, code_verifier: verifier },
    { code_challenge: challenge, current_password: 'secret' },
  ])('rejects invalid public start payload %# before fetching', async (payload) => {
    await expect(client.auth.startGitHubSignIn(payload as never)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['', 'é'.repeat(37), 'bad\ud800password', null])(
    'rejects invalid linking password %# before fetching',
    async (password) => {
      await expect(
        client.auth.startGitHubLink({
          code_challenge: challenge,
          current_password: password as never,
        })
      ).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    {},
    { ...callback, state: 'B'.repeat(43) },
    { ...callback, code: '' },
    { ...callback, code: 'x'.repeat(513) },
    { ...callback, code: 'code\nsecret' },
    { ...callback, code_verifier: 'x'.repeat(42) },
    { ...callback, code_verifier: 'x'.repeat(129) },
    { ...callback, code_verifier: 'x'.repeat(42) + '+' },
    { ...callback, redirect_uri: 'https://evil.test' },
  ])('rejects invalid callback payload %# without disclosing it', async (payload) => {
    await expect(client.auth.completeGitHubSignIn(payload as never)).rejects.toThrow(
      'opaque GitHub code'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['x'.repeat(43), 'x'.repeat(128), '-._~'.repeat(16)])(
    'accepts the RFC verifier alphabet and length %# unchanged',
    async (code_verifier) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, { message: 'Logged in', token: 'new.jwt', user })
      );
      await client.auth.completeGitHubSignIn({ ...callback, code_verifier });
      expect(getLastRequest(mockFetch).body).toEqual({ ...callback, code_verifier });
    }
  );
  it.each([
    { code_challenge_method: 'plain' },
    { code_challenge: 'A'.repeat(43) },
    { state: 'B'.repeat(43) },
    { scope: 'repo' },
    { redirect_uri: 'https://app.test/auth/github/callback?unexpected=1' },
    { redirect_uri: 'https://app.test/auth/github/callback#' },
    { redirect_uri: 'http://external.test/auth/github/callback' },
    { redirect_uri: 'http://local\nhost:3000/auth/github/callback' },
    { redirect_uri: 'https://user:pass@app.test/auth/github/callback' },
  ])('rejects unsafe or mismatched authorization response %#', async (params) => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { authorization_url: authorization(params), expires_in: 600 })
    );
    await expect(
      client.auth.startGitHubSignIn({ code_challenge: challenge })
    ).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    authorization().replace('github.com', 'github.com.evil.test'),
    authorization().replace('github.com', 'git\nhub.com'),
    authorization() + '&state=' + state,
    authorization() + '#',
    authorization() + '&client_secret=secret',
    '/relative-url',
  ])('rejects malicious redirect URL %# without including it in errors', async (url) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { authorization_url: url, expires_in: 600 }));
    await expect(client.auth.startGitHubSignIn({ code_challenge: challenge })).rejects.toThrow(
      'Unconfirmed GitHub response'
    );
  });
  it.each([
    'https://app.test/auth/github/callback',
    'http://127.0.0.2:3000/auth/github/callback',
    'http://[::1]:3000/auth/github/callback',
  ])('accepts secure and loopback callback addresses %#', async (redirect_uri) => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { authorization_url: authorization({ redirect_uri }), expires_in: 600 })
    );
    await expect(
      client.auth.startGitHubSignIn({ code_challenge: challenge })
    ).resolves.toHaveProperty('expires_in', 600);
  });
  it.each([0, 601, 1.5, '600', null])(
    'requires a bounded integer transaction lifetime %#',
    async (expires_in) => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, { ...response(), expires_in }));
      await expect(
        client.auth.startGitHubSignIn({ code_challenge: challenge })
      ).rejects.toBeInstanceOf(NetworkError);
    }
  );
  it.each([
    null,
    {},
    { message: 'OK' },
    { message: 'OK', token: '', user },
    {
      message: 'OK',
      token: 'new.jwt',
      user: { ...user, verification_required: true, email_verified: false },
    },
  ])('rejects malformed or verification-blocked sign-in acknowledgement %#', async (value) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, value));
    await expect(client.auth.completeGitHubSignIn(callback)).rejects.toBeInstanceOf(NetworkError);
    expect(client.getAuthToken()).toBe('existing.jwt');
  });
  it('rejects login-shaped linking responses rather than accepting a new account', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'OK', token: 'new.jwt', user }));
    await expect(client.auth.completeGitHubLink(callback)).rejects.toBeInstanceOf(NetworkError);
    expect(client.getAuthToken()).toBe('existing.jwt');
  });
  it.each([
    { providers: { github: true } },
    { providers: { password: true, github: 'true' } },
    null,
  ])('rejects incomplete provider discovery %#', async (value) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, value));
    await expect(client.auth.getProviders()).rejects.toBeInstanceOf(NetworkError);
  });
  it.each([201, 202, 204])('requires HTTP 200 acknowledgements, rejecting %s', async (status) => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(status, status === 204 ? null : { message: 'OK', token: 'new.jwt', user })
    );
    await expect(client.auth.completeGitHubSignIn(callback)).rejects.toBeInstanceOf(NetworkError);
  });
  it.each([400, 401, 403, 404, 408, 409, 429, 503])(
    'preserves error code and status without retrying HTTP %s',
    async (status) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(status, { error: 'Failed', code: 'github_oauth_failure' })
      );
      await expect(client.auth.completeGitHubSignIn(callback)).rejects.toMatchObject({
        statusCode: status,
        errorData: { code: 'github_oauth_failure' },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(client.getAuthToken()).toBe('existing.jwt');
    }
  );
  it('preserves rate-limit retry guidance without sleeping', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        429,
        { error: 'Wait', code: 'github_oauth_rate_limited' },
        { 'Retry-After': '600' }
      )
    );
    await expect(
      client.auth.startGitHubSignIn({ code_challenge: challenge })
    ).rejects.toMatchObject({ retryAfterSeconds: 600 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry an unknown exchange outcome', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Connection lost'));
    await expect(client.auth.completeGitHubSignIn(callback)).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('does not send a pre-aborted exchange', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.auth.completeGitHubSignIn(callback, { signal: controller.signal })
    ).rejects.toBeInstanceOf(RequestAbortedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('honors cancellation while reading an exchange response', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementationOnce(async (_url, init) => {
      const response = mockResponse(200, {});
      response.text = () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Stopped')), {
            once: true,
          });
          controller.abort();
        });
      return response;
    });
    await expect(
      client.auth.completeGitHubSignIn(callback, { signal: controller.signal })
    ).rejects.toBeInstanceOf(RequestAbortedError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('bounds response-body consumption with a total deadline', async () => {
    mockFetch.mockImplementationOnce(async (_url, init) => {
      const response = mockResponse(200, {});
      response.text = () =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('Stopped')), {
            once: true,
          })
        );
      return response;
    });
    await expect(client.auth.completeGitHubLink(callback, { timeout: 10 })).rejects.toBeInstanceOf(
      TimeoutError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ timeout: 0 }, { headers: { Authorization: 'Bearer injected' } }, { signal: {} }])(
    'rejects unsupported request options %#',
    async (options) => {
      await expect(client.auth.completeGitHubSignIn(callback, options as never)).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
});
