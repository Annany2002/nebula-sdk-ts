import { createTestClient, mockResponse } from '../test-helpers';
import { AuthError, NetworkError } from '../../src/errors';

const profile = {
  userId: 'owner',
  username: 'builder',
  email: 'builder@example.test',
  createdAt: '2026-10-18T00:00:00Z',
  avatar_url: '/avatars/8b7b6518-0d58-4dbe-af85-c0ded1d1ed3a',
  avatar_source: 'upload',
  onboarding_completed: true,
};
describe('Account avatars', () => {
  const { client, mockFetch } = createTestClient();
  beforeEach(() => {
    mockFetch.mockReset();
    client.setAuthToken('owner.jwt');
  });
  it('uploads multipart without a manual boundary and projects the safe profile', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { ...profile, password_hash: 'never-return' })
    );
    expect(
      await client.auth.uploadAvatar(new Blob(['fixture-image'], { type: 'image/png' }))
    ).toEqual(profile);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://api.nebula-test.com/api/v1/account/user/me/avatar');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      credentials: 'omit',
      headers: { Authorization: 'Bearer owner.jwt' },
    });
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    expect(init?.body).toBeInstanceOf(FormData);
    const keys: string[] = [];
    (init?.body as FormData).forEach((_value, key) => keys.push(key));
    expect(keys).toEqual(['avatar']);
    expect(client.getAuthToken()).toBe('owner.jwt');
  });
  it.each(['removeAvatar', 'completeOnboarding'] as const)(
    'uses owner Bearer auth for %s and never exposes credentials',
    async (method) => {
      const expected =
        method === 'removeAvatar' ? { ...profile, avatar_url: '', avatar_source: 'none' } : profile;
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));
      expect(await client.auth[method]()).toEqual(expected);
      expect(new Headers(mockFetch.mock.calls[0][1]?.headers).get('Authorization')).toBe(
        'Bearer owner.jwt'
      );
      expect(mockFetch.mock.calls[0][1]?.method).toBe(
        method === 'removeAvatar' ? 'DELETE' : 'POST'
      );
      expect(mockFetch.mock.calls[0][1]?.body).toBeUndefined();
    }
  );
  it('rejects empty, oversized and unsupported files before sending', async () => {
    for (const file of [
      new Blob([]),
      new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]),
      new Blob(['svg'], { type: 'image/svg+xml' }),
    ])
      await expect(client.auth.uploadAvatar(file)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('does not fall back to a database API key', async () => {
    client.setAuthToken(null);
    await expect(client.auth.completeOnboarding()).rejects.toThrow(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { avatar_url: 'javascript:alert(1)' },
    { avatar_url: 'https://evil.test/avatar' },
    { avatar_source: 'other' },
    { onboarding_completed: 'true' },
  ])('rejects malformed profile fields: %j', async (fields) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { ...profile, ...fields }));
    await expect(client.auth.removeAvatar()).rejects.toThrow(NetworkError);
  });
  it('preserves GitHub avatars and accepts legacy servers without avatar fields', async () => {
    const github = {
      ...profile,
      avatar_url: 'https://avatars.githubusercontent.com/u/123?v=4',
      avatar_source: 'github',
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, github));
    expect(await client.auth.getMe()).toEqual(github);
    const legacy = {
      userId: profile.userId,
      username: profile.username,
      email: profile.email,
      createdAt: profile.createdAt,
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, legacy));
    expect(await client.auth.getMe()).toEqual(legacy);
  });
});
