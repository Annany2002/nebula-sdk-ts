// test/modules/record.test.ts
import { createTestClient, mockResponse, getLastRequest } from '../test-helpers';
import { CreateRecordPayload, UpdateRecordPayload, RecordResponse, FilterParams, ListOptions } from '../../src/types';
import { AuthError, BadRequestError, NotFoundError } from '../../src/errors';

const { client, mockFetch } = createTestClient();

describe('RecordModule', () => {
  const dbName = 'test_db';
  const tableName = 'items';
  const recordId = 123;

  const sampleData: CreateRecordPayload = { name: 'Test Item', value: 100, active: true };
  const sampleResponse: RecordResponse = { id: recordId, ...sampleData };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  // --- Create ---
  describe('create', () => {
    it('should POST record data and return created record', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(201, sampleResponse));

      const result = await client.records.create(dbName, tableName, sampleData);
      expect(result).toEqual(sampleResponse);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain(`/databases/${dbName}/tables/${tableName}/records`);
      expect(req.method).toBe('POST');
      expect(req.body).toEqual(sampleData);
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Schema mismatch' }));
      await expect(client.records.create(dbName, tableName, sampleData)).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Table not found' }));
      await expect(client.records.create(dbName, tableName, sampleData)).rejects.toThrow(NotFoundError);
    });

    it('should throw validation error for empty payload', async () => {
      await expect(client.records.create(dbName, tableName, {})).rejects.toThrow(
        'Record data payload cannot be empty.'
      );
    });
  });

  // --- List ---
  describe('list', () => {
    it('should GET records without parameters', async () => {
      const expected = [sampleResponse, { id: 124, name: 'Another', value: 200 }];
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.records.list(dbName, tableName);
      expect(result).toEqual(expected);
      expect(result).toHaveLength(2);
    });

    it('should GET records with filter params as query parameters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, [sampleResponse]));

      const filters: FilterParams = { active: true, value: 100 };
      const result = await client.records.list(dbName, tableName, filters);
      expect(result).toEqual([sampleResponse]);
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('active=true');
      expect(url).toContain('value=100');
    });

    it('should append ListOptions -- pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, []));
      const options: ListOptions = { limit: 10, offset: 20 };
      await client.records.list(dbName, tableName, undefined, options);
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });

    it('should append ListOptions -- sorting', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, []));
      const options: ListOptions = { sort: 'name', order: 'desc' };
      await client.records.list(dbName, tableName, undefined, options);
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('sort=name');
      expect(url).toContain('order=desc');
    });

    it('should append ListOptions -- field selection', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, []));
      const options: ListOptions = { fields: 'id,name' };
      await client.records.list(dbName, tableName, undefined, options);
      // "id,name" will be URL-encoded as "id%2Cname" by URLSearchParams
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('fields=');
    });

    it('should merge filters and ListOptions', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, [sampleResponse]));
      const filters: FilterParams = { active: true };
      const options: ListOptions = { limit: 5, sort: 'value' };
      await client.records.list(dbName, tableName, filters, options);
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('active=true');
      expect(url).toContain('limit=5');
      expect(url).toContain('sort=value');
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Table not found' }));
      await expect(client.records.list(dbName, tableName)).rejects.toThrow(NotFoundError);
    });
  });

  // --- Get ---
  describe('get', () => {
    it('should GET a single record by ID', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, sampleResponse));

      const result = await client.records.get(dbName, tableName, recordId);
      expect(result).toEqual(sampleResponse);
      expect(getLastRequest(mockFetch).url).toContain(`/records/${recordId}`);
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Record not found' }));
      await expect(client.records.get(dbName, tableName, 999)).rejects.toThrow(NotFoundError);
    });

    it('should throw validation error for invalid recordId', async () => {
      await expect(client.records.get(dbName, tableName, 0)).rejects.toThrow('Record ID must be a positive integer.');
      await expect(client.records.get(dbName, tableName, -1)).rejects.toThrow('Record ID must be a positive integer.');
      await expect(client.records.get(dbName, tableName, 1.5)).rejects.toThrow('Record ID must be a positive integer.');
    });
  });

  // --- Update ---
  describe('update', () => {
    it('should PUT partial data and return updated record', async () => {
      const update: UpdateRecordPayload = { active: false, value: 150 };
      const expected = { ...sampleResponse, ...update };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.records.update(dbName, tableName, recordId, update);
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.method).toBe('PUT');
      expect(req.body).toEqual(update);
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Type mismatch' }));
      await expect(client.records.update(dbName, tableName, recordId, { value: 'x' })).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Record not found' }));
      await expect(client.records.update(dbName, tableName, recordId, { active: true })).rejects.toThrow(NotFoundError);
    });

    it('should throw validation error for empty payload', async () => {
      await expect(client.records.update(dbName, tableName, recordId, {})).rejects.toThrow(
        'Update payload cannot be empty.'
      );
    });
  });

  // --- Delete ---
  describe('delete', () => {
    it('should send DELETE request', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(204));
      await expect(client.records.delete(dbName, tableName, recordId)).resolves.toBeUndefined();
      expect(getLastRequest(mockFetch).method).toBe('DELETE');
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Record not found' }));
      await expect(client.records.delete(dbName, tableName, recordId)).rejects.toThrow(NotFoundError);
    });

    it('should throw validation error for invalid recordId', async () => {
      await expect(client.records.delete(dbName, tableName, 0)).rejects.toThrow('Record ID must be a positive integer.');
    });
  });

  // --- Auth ---
  describe('auth check', () => {
    it('should throw AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Token required' }));
      await expect(client.records.list(dbName, tableName)).rejects.toThrow(AuthError);
    });
  });
});
