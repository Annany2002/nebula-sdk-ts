import { NetworkError, RequestAbortedError, TimeoutError } from '../../src/errors';
import { createTestClient, getLastRequest, mockResponse } from '../test-helpers';

const token = 'A'.repeat(43);
const payload = { token, password: 'NewPassword123!' };
describe('Password recovery contracts', () => {
  const { client, mockFetch } = createTestClient();
  beforeEach(() => {
    mockFetch.mockReset();
    client.setAuthToken('existing.jwt');
  });
  it.each(['request', 'reset'] as const)(
    '%s sends body-only credentials without JWT/API key and projects its response',
    async (action) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(action === 'request' ? 202 : 200, {
          message: 'Acknowledged',
          token: 'must-not-escape',
          user: { password_hash: 'secret' },
        })
      );
      const result =
        action === 'request'
          ? await client.auth.forgotPassword('owner@example.test')
          : await client.auth.resetPassword(payload);
      expect(result).toEqual({ message: 'Acknowledged' });
      const request = getLastRequest(mockFetch);
      expect(request.url).toBe(
        'http://api.nebula-test.com/auth/' +
          (action === 'request' ? 'forgot-password' : 'reset-password')
      );
      expect(request.body).toEqual(
        action === 'request' ? { email: 'owner@example.test' } : payload
      );
      expect(request.headers.Authorization).toBeUndefined();
      expect(mockFetch.mock.calls[0][1]).toMatchObject({
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(client.getAuthToken()).toBe('existing.jwt');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['', 'invalid', 'owner\r\n@example.test', 'øwner@example.test'])(
    'rejects invalid email %# before fetch',
    async (email) => {
      await expect(client.auth.forgotPassword(email)).rejects.toThrow('email address');
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    { token: 'bad', password: payload.password },
    { token: 'https://app.example.test/reset-password#token=' + token, password: payload.password },
    { token: 'B'.repeat(43), password: payload.password },
    { token, password: 'short' },
    { token, password: 'é'.repeat(37) },
    { token, password: '😀'.repeat(19) },
    { token, password: 'broken\ud800password' },
    { ...payload, user_id: 'other' },
    null,
  ])('rejects invalid reset payload %# before fetch', async (value) => {
    await expect(client.auth.resetPassword(value as typeof payload)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['é'.repeat(36), '😀'.repeat(8), ' '.repeat(8)])(
    'preserves supported password bytes unchanged %#',
    async (password) => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'Updated' }));
      await client.auth.resetPassword({ token, password });
      expect(getLastRequest(mockFetch).body).toEqual({ token, password });
    }
  );
  it.each([200, 201, 204])(
    'requires 202 for forgot-password, rejecting HTTP %s',
    async (status) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(status, status === 204 ? null : { message: 'Acknowledged' })
      );
      await expect(client.auth.forgotPassword('owner@example.test')).rejects.toBeInstanceOf(
        NetworkError
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );
  it.each([{}, { message: '' }, { message: 3 }, null])(
    'rejects malformed reset acknowledgement %#',
    async (body) => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, body));
      await expect(client.auth.resetPassword(payload)).rejects.toBeInstanceOf(NetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );
  it.each([400, 429, 503])(
    'preserves server error codes without retrying HTTP %s',
    async (status) => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(status, { error: 'Failed', code: 'password_reset_failure' })
      );
      await expect(client.auth.resetPassword(payload)).rejects.toMatchObject({
        statusCode: status,
        errorData: { code: 'password_reset_failure' },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(client.getAuthToken()).toBe('existing.jwt');
    }
  );
  it('does not retry an unknown network write outcome', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('connection lost'));
    await expect(client.auth.resetPassword(payload)).rejects.toBeInstanceOf(NetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('honors pre-aborted requests before sending credentials', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.auth.resetPassword(payload, { signal: controller.signal })
    ).rejects.toBeInstanceOf(RequestAbortedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('bounds response-body consumption with the total deadline', async () => {
    mockFetch.mockImplementationOnce(async (_url, init) => {
      const response = mockResponse(200, { message: 'Reset' });
      response.text = () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('stopped')), {
            once: true,
          });
        });
      return response;
    });
    await expect(client.auth.resetPassword(payload, { timeout: 10 })).rejects.toBeInstanceOf(
      TimeoutError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('rejects caller-supplied identity and credential options', async () => {
    await expect(
      client.auth.forgotPassword('owner@example.test', { user_id: 'other' } as never)
    ).rejects.toThrow('options');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
