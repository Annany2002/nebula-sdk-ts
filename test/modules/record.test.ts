// test/modules/record.test.ts
import { createTestClient, mockResponse, getLastRequest } from '../test-helpers';
import {
  CreateRecordPayload,
  UpdateRecordPayload,
  RecordResponse,
  FilterParams,
  ListOptions,
  RecordListResponse,
  RecordMutationResponse,
  RecordId,
} from '../../src/types';
import { AuthError, BadRequestError, NotFoundError } from '../../src/errors';

const { client, mockFetch } = createTestClient();

describe('RecordModule', () => {
  const dbName = 'test_db';
  const tableName = 'items';
  const recordId = 123;

  const sampleData: CreateRecordPayload = { name: 'Test Item', value: 100, active: true };
  const sampleResponse: RecordResponse = { id: recordId, ...sampleData };
  const mutation: RecordMutationResponse = {
    message: 'Record created successfully',
    record_id: recordId,
  };
  const page = (records: RecordResponse[]): RecordListResponse => ({
    records,
    pagination: { total: records.length, limit: 100, offset: 0 },
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  // --- Create ---
  describe('create', () => {
    it('should POST record data and return a creation acknowledgement', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(201, mutation));

      const result = await client.records.create(dbName, tableName, sampleData);
      expect(result).toEqual(mutation);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain(`/databases/${dbName}/tables/${tableName}/records`);
      expect(req.method).toBe('POST');
      expect(req.body).toEqual(sampleData);
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Schema mismatch' }));
      await expect(client.records.create(dbName, tableName, sampleData)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Table not found' }));
      await expect(client.records.create(dbName, tableName, sampleData)).rejects.toThrow(
        NotFoundError
      );
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
      const expected = page([sampleResponse, { id: 124, name: 'Another', value: 200 }]);
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.records.list(dbName, tableName);
      expect(result).toEqual(expected);
      expect(result.records).toHaveLength(2);
    });

    it('should GET records with filter params as query parameters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, page([sampleResponse])));

      const filters: FilterParams = { active: true, value: 100 };
      const result = await client.records.list(dbName, tableName, filters);
      expect(result).toEqual(page([sampleResponse]));
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('active=true');
      expect(url).toContain('value=100');
    });

    it('should append ListOptions -- pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, page([])));
      const options: ListOptions = { limit: 10, offset: 20 };
      await client.records.list(dbName, tableName, undefined, options);
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });

    it('should append ListOptions -- sorting', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, page([])));
      const options: ListOptions = { sort: 'name', order: 'desc' };
      await client.records.list(dbName, tableName, undefined, options);
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('sort=name');
      expect(url).toContain('order=desc');
    });

    it('should append ListOptions -- field selection', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, page([])));
      const options: ListOptions = { fields: 'id,name' };
      await client.records.list(dbName, tableName, undefined, options);
      // "id,name" will be URL-encoded as "id%2Cname" by URLSearchParams
      const url = getLastRequest(mockFetch).url;
      expect(url).toContain('fields=');
    });

    it('should merge filters and ListOptions', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, page([sampleResponse])));
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

    it.each([undefined, null, false])(
      'rejects missing or non-scalar IDs %s before fetch',
      async (key) => {
        await expect(
          client.records.get(dbName, tableName, key as unknown as RecordId)
        ).rejects.toThrow(
          'Record ID must be a non-empty string or a finite, safely represented number.'
        );
        expect(mockFetch).not.toHaveBeenCalled();
      }
    );

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Record not found' }));
      await expect(client.records.get(dbName, tableName, 999)).rejects.toThrow(NotFoundError);
    });

    it.each([0, -1, 1.5, 'item one?#', '9223372036854775807'])(
      'encodes supported key %s',
      async (key) => {
        mockFetch.mockResolvedValueOnce(mockResponse(200, { item_key: key }));
        await client.records.get(dbName, tableName, key);
        expect(getLastRequest(mockFetch).url).toContain(
          `/records/${encodeURIComponent(String(key))}`
        );
      }
    );

    it.each(['', NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid key %s before fetch',
      async (key) => {
        await expect(client.records.get(dbName, tableName, key)).rejects.toThrow(
          'Record ID must be a non-empty string or a finite, safely represented number.'
        );
        expect(mockFetch).not.toHaveBeenCalled();
      }
    );
  });

  // --- Update ---
  describe('update', () => {
    it('should PUT partial data and return an update acknowledgement', async () => {
      const update: UpdateRecordPayload = { active: false, value: 150 };
      const expected: RecordMutationResponse = {
        message: 'Record updated successfully',
        record_id: recordId,
      };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.records.update(dbName, tableName, recordId, update);
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.method).toBe('PUT');
      expect(req.body).toEqual(update);
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Type mismatch' }));
      await expect(
        client.records.update(dbName, tableName, recordId, { value: 'x' })
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Record not found' }));
      await expect(
        client.records.update(dbName, tableName, recordId, { active: true })
      ).rejects.toThrow(NotFoundError);
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
      await expect(client.records.delete(dbName, tableName, recordId)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw validation error for invalid recordId', async () => {
      await expect(client.records.delete(dbName, tableName, '')).rejects.toThrow(
        'Record ID must be a non-empty string or a finite, safely represented number.'
      );
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
