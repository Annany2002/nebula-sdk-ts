// test/modules/schema.test.ts
import { createTestClient, mockResponse, getLastRequest } from '../test-helpers';
import { SchemaPayload, SchemaInfoResponse, ColumnDefinition } from '../../src/types';
import { BadRequestError, NotFoundError } from '../../src/errors';

const { client, mockFetch } = createTestClient();

describe('SchemaModule', () => {
  const dbName = 'my_app_db';

  const sampleColumns: ColumnDefinition[] = [
    { name: 'description', type: 'TEXT' },
    { name: 'priority', type: 'INTEGER' },
    { name: 'done', type: 'BOOLEAN' },
  ];
  const samplePayload: SchemaPayload = { table_name: 'tasks', columns: sampleColumns };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  // --- Define Schema ---
  describe('define', () => {
    it('should POST schema payload and return info', async () => {
      const expected: SchemaInfoResponse = { table_name: 'tasks', columns: sampleColumns, message: 'Table created' };
      mockFetch.mockResolvedValueOnce(mockResponse(201, expected));

      const result = await client.schema.define(dbName, samplePayload);
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain(`/api/v1/databases/${dbName}/schema`);
      expect(req.method).toBe('POST');
      expect(req.body).toEqual(samplePayload);
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Table exists' }));
      await expect(client.schema.define(dbName, samplePayload)).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError if database does not exist', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Database not found' }));
      await expect(client.schema.define('ghost_db', samplePayload)).rejects.toThrow(NotFoundError);
    });

    it('should throw validation error for invalid input', async () => {
      await expect(client.schema.define('', samplePayload)).rejects.toThrow('Database name is required.');
      await expect(client.schema.define(dbName, {} as any)).rejects.toThrow(
        'Table name and at least one column definition are required.'
      );
      await expect(client.schema.define(dbName, { table_name: 't', columns: [] })).rejects.toThrow(
        'Table name and at least one column definition are required.'
      );
    });
  });

  // --- List Tables ---
  describe('listTables', () => {
    it('should GET table list for a database', async () => {
      const expected = {
        tables: [{
          type: 'table', name: 'tasks', tbl_name: 'tasks', rootpage: '2',
          sql: 'CREATE TABLE tasks (...)', createdAt: '2026-01-01', columns: sampleColumns,
        }],
      };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.schema.listTables(dbName);
      expect(result).toEqual(expected);
      expect(result.tables).toHaveLength(1);
      expect(getLastRequest(mockFetch).url).toContain(`/api/v1/databases/${dbName}/tables`);
    });

    it('should throw NotFoundError if database does not exist', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Database not found' }));
      await expect(client.schema.listTables('ghost_db')).rejects.toThrow(NotFoundError);
    });

    it('should throw validation error if dbName is empty', async () => {
      await expect(client.schema.listTables('')).rejects.toThrow('Database name is required.');
    });
  });

  // --- Get Schema ---
  describe('getSchema', () => {
    it('should GET schema for a specific table', async () => {
      const expected: SchemaInfoResponse = { table_name: 'tasks', columns: sampleColumns };
      mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

      const result = await client.schema.getSchema(dbName, 'tasks');
      expect(result).toEqual(expected);
      expect(getLastRequest(mockFetch).url).toContain(`/api/v1/databases/${dbName}/tables/tasks/schema`);
    });

    it('should URL-encode table name', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, { table_name: 'my table', columns: [] }));
      await client.schema.getSchema(dbName, 'my table');
      expect(getLastRequest(mockFetch).url).toContain(encodeURIComponent('my table'));
    });

    it('should throw validation errors for empty args', async () => {
      await expect(client.schema.getSchema('', 'tasks')).rejects.toThrow('Database name is required.');
      await expect(client.schema.getSchema(dbName, '')).rejects.toThrow('Table name is required.');
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Table not found' }));
      await expect(client.schema.getSchema(dbName, 'ghost')).rejects.toThrow(NotFoundError);
    });
  });

  // --- Create Table ---
  describe('createTable', () => {
    it('should POST to /tables endpoint', async () => {
      const payload: SchemaPayload = { table_name: 'posts', columns: [{ name: 'title', type: 'TEXT' }] };
      const expected: SchemaInfoResponse = { ...payload, message: 'Table created' };
      mockFetch.mockResolvedValueOnce(mockResponse(201, expected));

      const result = await client.schema.createTable(dbName, payload);
      expect(result).toEqual(expected);
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain(`/api/v1/databases/${dbName}/tables`);
      expect(req.url).not.toContain('/schema');
      expect(req.method).toBe('POST');
    });

    it('should throw validation error for invalid input', async () => {
      await expect(client.schema.createTable('', samplePayload)).rejects.toThrow('Database name is required.');
      await expect(client.schema.createTable(dbName, {} as any)).rejects.toThrow(
        'Table name and at least one column definition are required.'
      );
    });

    it('should throw BadRequestError on 400', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Table exists' }));
      await expect(client.schema.createTable(dbName, samplePayload)).rejects.toThrow(BadRequestError);
    });
  });

  // --- Delete Table ---
  describe('deleteTable', () => {
    it('should send DELETE request', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(204));
      await expect(client.schema.deleteTable(dbName, 'tasks')).resolves.toBeUndefined();
      const req = getLastRequest(mockFetch);
      expect(req.url).toContain(`/api/v1/databases/${dbName}/tables/tasks`);
      expect(req.method).toBe('DELETE');
    });

    it('should URL-encode table name', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(204));
      await client.schema.deleteTable(dbName, 'table/slash');
      expect(getLastRequest(mockFetch).url).toContain(encodeURIComponent('table/slash'));
    });

    it('should throw NotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, { error: 'Table not found' }));
      await expect(client.schema.deleteTable(dbName, 'ghost')).rejects.toThrow(NotFoundError);
    });

    it('should throw validation errors for empty args', async () => {
      await expect(client.schema.deleteTable('', 'tasks')).rejects.toThrow('Database name is required.');
      await expect(client.schema.deleteTable(dbName, '')).rejects.toThrow('Table name is required.');
    });
  });
});
