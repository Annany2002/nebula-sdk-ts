import { randomUUID } from 'node:crypto';
import { NebulaClient } from '../../src/client';

const baseURL = process.env.NEBULA_TEST_URL;
const suite = baseURL ? describe : describe.skip;
suite('Account avatars against the isolated backend', () => {
  let client: NebulaClient;
  let other: NebulaClient;
  let asset: string;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPojvn2HwAGMALdVh+OhAAAAABJRU5ErkJggg==',
    'base64'
  );
  beforeAll(async () => {
    const url = new URL(baseURL!);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
      throw new Error('Disposable loopback backend required.');
    async function account() {
      const result = new NebulaClient({ baseURL: baseURL! });
      const email = `avatar-${randomUUID()}@example.test`;
      await result.auth.signup({
        email,
        username: 'avatar-builder',
        password: 'sdk-test-password',
      });
      const login = await result.auth.login({ email, password: 'sdk-test-password' });
      expect(login.user).toMatchObject({ avatar_url: '', onboarding_completed: false });
      result.setAuthToken(login.token);
      return result;
    }
    client = await account();
    other = await account();
  });
  it('persists skip, uploads a normalized public image, and keeps accounts isolated', async () => {
    await expect(client.auth.completeOnboarding()).resolves.toMatchObject({
      onboarding_completed: true,
      avatar_url: '',
    });
    const photo = await client.auth.uploadAvatar(new Blob([png], { type: 'image/png' }));
    expect(photo).toMatchObject({ onboarding_completed: true, avatar_source: 'upload' });
    asset = photo.avatar_url!;
    expect(asset).toMatch(/^\/avatars\/[a-f0-9-]{36}$/);
    const response = await fetch(baseURL! + asset);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([255, 216, 255]);
    await expect(other.auth.getMe()).resolves.toMatchObject({
      avatar_url: '',
      onboarding_completed: false,
    });
    await expect(client.auth.getMe()).resolves.toMatchObject({ avatar_url: asset });
  });
  it('rejects disguised SVG without altering the saved photo, then revokes the old URL on removal', async () => {
    await expect(
      client.auth.uploadAvatar(new Blob(['<svg/>'], { type: 'image/png' }))
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.auth.getMe()).resolves.toMatchObject({ avatar_url: asset });
    await expect(client.auth.removeAvatar()).resolves.toMatchObject({
      avatar_url: '',
      avatar_source: 'none',
      onboarding_completed: true,
    });
    expect((await fetch(baseURL! + asset)).status).toBe(404);
  });
});
