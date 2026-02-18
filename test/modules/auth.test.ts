// test/modules/auth.test.ts
import { createTestClient, mockResponse, getLastRequest } from '../test-helpers';
import { AuthError, BadRequestError, NotFoundError } from '../../src/errors';

const { client, mockFetch } = createTestClient();

describe('AuthModule', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // --- Signup ---
  describe('signup', () => {
    it('should POST credentials and return signup response', async () => {
      const credentials = { username: 'newuser', email: 'new@test.com', password: 'pass123' };
      const expected = { message: 'Account created', userId: 'u123' };
      mockFetch.mockResolvedValueOnce(mockResponse(201, expected));

      const result = await client.auth.signup(credentials);
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/auth/signup');
      expect(req.method).toBe('POST');
      expect(req.body).toEqual(credentials);
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Invalid email' }));
      await expect(client.auth.signup({ username: 'x', email: 'bad', password: '1' }))
        .rejects.toThrow(BadRequestError);
    });
  });

  // --- Login ---
  describe('login', () => {
    it('should POST credentials and return token', async () => {
      const credentials = { email: 'user@test.com', password: 'pass123' };
      const expected = { token: 'jwt.token.here', user: { userId: 'u1' } };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.auth.login(credentials);
      expect(result).toEqual(expected);
      expect(result.token).toBe('jwt.token.here');
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/auth/login');
      expect(req.method).toBe('POST');
    });

    it('should throw AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Invalid credentials' }));
      await expect(client.auth.login({ email: 'user@test.com', password: 'wrong' }))
        .rejects.toThrow(AuthError);
    });
  });

  // --- Health Check ---
  describe('healthP', () => {
    it('should GET /api/v1/health with ApiKey header', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, { status: 'ok' }));

      const result = await client.auth.healthP();
      expect(result).toBeDefined();
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/api/v1/health');
      expect(req.headers['Authorization']).toContain('ApiKey');
    });

    it('should throw AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Invalid API key' }));
      await expect(client.auth.healthP()).rejects.toThrow(AuthError);
    });
  });

  // --- GetMe ---
  describe('getMe', () => {
    it('should GET /api/v1/account/user/me', async () => {
      const userInfo = { userId: 'u1', username: 'john', email: 'john@test.com', createdAt: '2026-01-01' };
      mockFetch.mockResolvedValueOnce(mockResponse(200, userInfo));

      const result = await client.auth.getMe();
      expect(result).toEqual(userInfo);
      expect(getLastRequest(mockFetch).url).toContain('/api/v1/account/user/me');
    });

    it('should throw AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Token expired' }));
      await expect(client.auth.getMe()).rejects.toThrow(AuthError);
    });
  });

  // --- UpdateProfile ---
  describe('updateProfile', () => {
    it('should PUT profile updates to /api/v1/account/user/me', async () => {
      const payload = { username: 'newname' };
      const expected = {
        message: 'Profile updated',
        user: { userId: 'u1', username: 'newname', email: 'john@test.com', createdAt: '2026-01-01' },
      };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.auth.updateProfile(payload);
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/api/v1/account/user/me');
      expect(req.method).toBe('PUT');
      expect(req.body).toEqual(payload);
    });

    it('should throw validation error if no fields provided', async () => {
      await expect(client.auth.updateProfile({} as any))
        .rejects.toThrow("No fields to update. Provide 'username' or 'email'.");
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Invalid email format' }));
      await expect(client.auth.updateProfile({ email: 'invalid' })).rejects.toThrow(BadRequestError);
    });
  });

  // --- FindUser ---
  describe('findUser', () => {
    it('should GET /api/v1/user/:user_id', async () => {
      const userInfo = { userId: 'u42', username: 'jane', email: 'jane@test.com', createdAt: '2026-02-01' };
      mockFetch.mockResolvedValueOnce(mockResponse(200, userInfo));

      const result = await client.auth.findUser('u42');
      expect(result).toEqual(userInfo);
      expect(getLastRequest(mockFetch).url).toContain('/api/v1/user/u42');
    });

    it('should throw validation error if userId is empty', async () => {
      await expect(client.auth.findUser('')).rejects.toThrow('User ID is required.');
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'User not found' }));
      await expect(client.auth.findUser('nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('should URL-encode userId', async () => {
      const userInfo = { userId: 'u/1', username: 'test', email: 'test@t.com', createdAt: '2026-01-01' };
      mockFetch.mockResolvedValueOnce(mockResponse(200, userInfo));

      const result = await client.auth.findUser('u/1');
      expect(result).toEqual(userInfo);
      expect(getLastRequest(mockFetch).url).toContain(encodeURIComponent('u/1'));
    });
  });
});
