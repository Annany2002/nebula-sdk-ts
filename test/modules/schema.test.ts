// test/modules/schema.test.ts
import nock from 'nock';
import { NebulaClient } from '../../src/client';
import {
  SchemaPayload,
  SchemaInfoResponse,
  TableListResponse,
  ColumnDefinition,
} from '../../src/types';
import { BadRequestError, NotFoundError } from '../../src/errors';

const mockBaseURL = 'http://api.nebula-test.com'; // Use the same URL as db tests
const client = new NebulaClient({ baseURL: mockBaseURL });
const token = 'valid-token-for-schema-tests';

describe('SchemaModule', () => {
  const dbName = 'my_app_db';
  const schemaBasePath = `/api/v1/databases/${dbName}`;

  const sampleColumns: ColumnDefinition[] = [
    { name: 'description', type: 'TEXT' },
    { name: 'priority', type: 'INTEGER' },
    { name: 'done', type: 'BOOLEAN' },
  ];
  const samplePayload: SchemaPayload = {
    table_name: 'tasks',
    columns: sampleColumns,
  };

  beforeAll(() => {
    client.setAuthToken(token);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    client.setAuthToken(null);
  });

  // --- Define Schema ---
  it('define should POST schema payload and return info', async () => {
    const expectedResponse: SchemaInfoResponse = {
      table_name: 'tasks',
      columns: sampleColumns,
      message: 'Table created',
    };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(`${schemaBasePath}/schema`, JSON.stringify(samplePayload))
      .reply(201, expectedResponse);

    const result = await client.schema.define(dbName, samplePayload);
    expect(result).toEqual(expectedResponse);
    expect(nock.isDone()).toBe(true);
  });

  it('define should throw BadRequestError on 400 (e.g., table exists, bad type)', async () => {
    const errorResponse = {
      error: 'Table already exists or invalid column type',
    };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(`${schemaBasePath}/schema`, JSON.stringify(samplePayload))
      .reply(400, errorResponse);

    await expect(client.schema.define(dbName, samplePayload)).rejects.toThrow(BadRequestError);
    await expect(client.schema.define(dbName, samplePayload)).rejects.toMatchObject({
      errorData: errorResponse,
    });
  });

  it('define should throw NotFoundError if database doesnt exist (404)', async () => {
    const nonExistentDb = 'no_such_db';
    const errorResponse = { error: 'Database not found' };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(`/api/v1/databases/${nonExistentDb}/schema`, JSON.stringify(samplePayload))
      .reply(404, errorResponse);

    await expect(client.schema.define(nonExistentDb, samplePayload)).rejects.toThrow(NotFoundError);
  });

  it('define should throw validation error for invalid input', async () => {
    await expect(client.schema.define('', samplePayload)).rejects.toThrow(
      'Database name is required.'
    );
    await expect(client.schema.define(dbName, {} as any)).rejects.toThrow(
      'Table name and at least one column definition are required.'
    );
    await expect(client.schema.define(dbName, { table_name: 't' } as any)).rejects.toThrow(
      'Table name and at least one column definition are required.'
    );
    await expect(client.schema.define(dbName, { table_name: 't', columns: [] })).rejects.toThrow(
      'Table name and at least one column definition are required.'
    );
  });

  // --- List Tables ---
  it('listTables should GET table names for a database', async () => {
    const expectedResponse: TableListResponse = { tables: ['tasks', 'users'] };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(`${schemaBasePath}/tables`)
      .reply(200, expectedResponse);

    const result = await client.schema.listTables(dbName);
    expect(result).toEqual(expectedResponse);
    expect(nock.isDone()).toBe(true);
  });

  it('listTables should throw NotFoundError if database doesnt exist (404)', async () => {
    const nonExistentDb = 'no_such_db_list';
    const errorResponse = { error: 'Database not found' };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(`/api/v1/databases/${nonExistentDb}/tables`)
      .reply(404, errorResponse);

    await expect(client.schema.listTables(nonExistentDb)).rejects.toThrow(NotFoundError);
  });

  it('listTables should throw validation error if dbName is missing', async () => {
    await expect(client.schema.listTables('')).rejects.toThrow('Database name is required.');
  });

  // --- Delete Table ---
  it('deleteTable should send DELETE request for the table name', async () => {
    const tableName = 'table_to_delete';
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${schemaBasePath}/tables/${tableName}`)
      .reply(204); // No content

    await expect(client.schema.deleteTable(dbName, tableName)).resolves.toBeUndefined();
    expect(nock.isDone()).toBe(true);
  });

  it('deleteTable should URL encode table name', async () => {
    const tableName = 'table with/slash';
    const encodedTableName = encodeURIComponent(tableName);
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${schemaBasePath}/tables/${encodedTableName}`)
      .reply(204);

    await expect(client.schema.deleteTable(dbName, tableName)).resolves.toBeUndefined();
    expect(nock.isDone()).toBe(true);
  });

  it('deleteTable should throw NotFoundError on 404 (db or table not found)', async () => {
    const tableName = 'non_existent_table';
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${schemaBasePath}/tables/${tableName}`)
      .reply(404, { error: 'Table not found' });

    await expect(client.schema.deleteTable(dbName, tableName)).rejects.toThrow(NotFoundError);
  });

  it('deleteTable should throw validation error for missing names', async () => {
    await expect(client.schema.deleteTable('', 't1')).rejects.toThrow('Database name is required.');
    await expect(client.schema.deleteTable('db1', '')).rejects.toThrow('Table name is required.');
  });
});
