// test/modules/database.test.ts
import { createTestClient, mockResponse, getLastRequest } from '../test-helpers';
import { DbCreatePayload, DbInfoResponse, ApiKeyResponse } from '../../src/types';
import { AuthError, BadRequestError, NotFoundError } from '../../src/errors';

const { client, mockFetch } = createTestClient();

describe('DatabaseModule', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // --- Create ---
  describe('create', () => {
    it('should POST database name and return info', async () => {
      const payload: DbCreatePayload = { db_name: 'new_db' };
      const expected: DbInfoResponse = { db_name: 'new_db', message: 'Database created' };
      mockFetch.mockResolvedValueOnce(mockResponse(201, expected));

      const result = await client.databases.create(payload);
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/api/v1/databases');
      expect(req.method).toBe('POST');
      expect(req.body).toEqual(payload);
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Name exists' }));
      await expect(client.databases.create({ db_name: 'dup' })).rejects.toThrow(BadRequestError);
    });

    it('should throw AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Invalid token' }));
      await expect(client.databases.create({ db_name: 'db' })).rejects.toThrow(AuthError);
    });

    it('should throw validation error if db_name is missing', async () => {
      await expect(client.databases.create({} as any)).rejects.toThrow('Database name (db_name) is required.');
      await expect(client.databases.create({ db_name: '' })).rejects.toThrow('Database name (db_name) is required.');
    });
  });

  // --- List ---
  describe('list', () => {
    it('should GET database list', async () => {
      const expected = {
        databases: [{
          id: 1, userId: 'u1', dbName: 'db1', filePath: '/data/db1',
          createdAt: '2026-01-01', tableCount: 2, apiKey: 'neb_key1',
        }],
      };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.databases.list();
      expect(result).toEqual(expected);
      expect(result.databases).toHaveLength(1);
      expect(getLastRequest(mockFetch).method).toBe('GET');
    });

    it('should throw AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Token required' }));
      await expect(client.databases.list()).rejects.toThrow(AuthError);
    });
  });

  // --- Delete ---
  describe('delete', () => {
    it('should send DELETE request', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(204));
      await expect(client.databases.delete('db_to_delete')).resolves.toBeUndefined();
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/api/v1/databases/db_to_delete');
      expect(req.method).toBe('DELETE');
    });

    it('should URL-encode database name', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(204));
      await client.databases.delete('db with spaces');
      expect(getLastRequest(mockFetch).url).toContain(encodeURIComponent('db with spaces'));
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Database not found' }));
      await expect(client.databases.delete('ghost')).rejects.toThrow(NotFoundError);
    });

    it('should throw validation error if dbName is empty', async () => {
      await expect(client.databases.delete('')).rejects.toThrow('Database name is required for deletion.');
    });
  });

  // --- API Key Management ---
  describe('getApiKey', () => {
    it('should GET the api key for a database', async () => {
      const expected: ApiKeyResponse = { api_key: 'neb_abc123' };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.databases.getApiKey('mydb');
      expect(result).toEqual(expected);
      expect(getLastRequest(mockFetch).url).toContain('/api/v1/account/databases/mydb/apikey');
    });

    it('should throw validation error if dbName is empty', async () => {
      await expect(client.databases.getApiKey('')).rejects.toThrow('Database name is required.');
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Not found' }));
      await expect(client.databases.getApiKey('ghost')).rejects.toThrow(NotFoundError);
    });
  });

  describe('createApiKey', () => {
    it('should POST to create a new API key', async () => {
      const expected: ApiKeyResponse = { api_key: 'neb_newkey', message: 'API key created' };
      mockFetch.mockResolvedValueOnce(mockResponse(201, expected));

      const result = await client.databases.createApiKey('mydb');
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/api/v1/account/databases/mydb/apikey');
      expect(req.method).toBe('POST');
    });

    it('should throw validation error if dbName is empty', async () => {
      await expect(client.databases.createApiKey('')).rejects.toThrow('Database name is required.');
    });
  });

  describe('deleteApiKey', () => {
    it('should DELETE the api key', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(204));
      await expect(client.databases.deleteApiKey('mydb')).resolves.toBeUndefined();
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain('/api/v1/account/databases/mydb/apikey');
      expect(req.method).toBe('DELETE');
    });

    it('should throw validation error if dbName is empty', async () => {
      await expect(client.databases.deleteApiKey('')).rejects.toThrow('Database name is required.');
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Not found' }));
      await expect(client.databases.deleteApiKey('mydb')).rejects.toThrow(NotFoundError);
    });
  });
});
