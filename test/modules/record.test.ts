// test/modules/record.test.ts
import nock from 'nock';
import { NebulaClient } from '../../src/client';
import {
  CreateRecordPayload,
  UpdateRecordPayload,
  RecordResponse,
  FilterParams,
} from '../../src/types';
import { AuthError, BadRequestError, NotFoundError } from '../../src/errors';

const mockBaseURL = 'http://api.nebula-test.com/v1'; // Base for v1 API calls
const client = new NebulaClient({ baseURL: mockBaseURL }); // Assuming baseURL points here
const token = 'valid-token-for-record-tests';

describe('RecordModule', () => {
  const dbName = 'test_db';
  const tableName = 'items';
  const recordId = 123;
  const basePath = `/api/v1/databases/${dbName}/tables/${tableName}/records`;

  const sampleRecordData: CreateRecordPayload = {
    name: 'Test Item',
    value: 100,
    active: true,
  };
  const sampleRecordResponse: RecordResponse = {
    id: recordId,
    ...sampleRecordData,
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

  // --- Create Record ---
  it('create should POST record data and return new record with ID', async () => {
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(basePath, sampleRecordData)
      .reply(201, sampleRecordResponse); // API returns the created record with ID

    const result = await client.records.create(dbName, tableName, sampleRecordData);
    expect(result).toEqual(sampleRecordResponse);
    expect(nock.isDone()).toBe(true);
  });

  it('create should throw BadRequestError on 400 (schema mismatch)', async () => {
    const errorResponse = {
      error: 'Data does not match schema type for column: value',
    };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(basePath, sampleRecordData)
      .reply(400, errorResponse);

    await expect(client.records.create(dbName, tableName, sampleRecordData)).rejects.toThrow(
      BadRequestError
    );
  });

  it('create should throw NotFoundError on 404 (db/table not found)', async () => {
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(basePath, sampleRecordData)
      .reply(404, { error: 'Table not found' });

    await expect(client.records.create(dbName, tableName, sampleRecordData)).rejects.toThrow(
      NotFoundError
    );
  });

  it('create should throw validation error for empty payload', async () => {
    await expect(client.records.create(dbName, tableName, {})).rejects.toThrow(
      'Record data payload cannot be empty.'
    );
  });

  // --- List Records ---
  it('list should GET records without filters', async () => {
    const expectedResponse: RecordResponse[] = [
      sampleRecordResponse,
      { id: 124, name: 'Another Item', value: 200, active: false },
    ];
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(basePath)
      .reply(200, expectedResponse);

    const result = await client.records.list(dbName, tableName);
    expect(result).toEqual(expectedResponse);
    expect(nock.isDone()).toBe(true);
  });

  it('list should GET records with filters as query parameters', async () => {
    const filters: FilterParams = { active: true, value: 100 };
    const expectedResponse: RecordResponse[] = [sampleRecordResponse]; // Only matching record

    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(basePath)
      .query(filters) // Nock matches query parameters
      .reply(200, expectedResponse);

    const result = await client.records.list(dbName, tableName, filters);
    expect(result).toEqual(expectedResponse);
    expect(nock.isDone()).toBe(true);
  });

  it('list should throw NotFoundError on 404 (db/table not found)', async () => {
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(basePath)
      .reply(404, { error: 'Table not found' });

    await expect(client.records.list(dbName, tableName)).rejects.toThrow(NotFoundError);
  });

  // --- Get Record ---
  it('get should GET a single record by ID', async () => {
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(`${basePath}/${recordId}`)
      .reply(200, sampleRecordResponse);

    const result = await client.records.get(dbName, tableName, recordId);
    expect(result).toEqual(sampleRecordResponse);
    expect(nock.isDone()).toBe(true);
  });

  it('get should throw NotFoundError on 404 (record not found)', async () => {
    const nonExistentId = 999;
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(`${basePath}/${nonExistentId}`)
      .reply(404, { error: 'Record not found' });

    await expect(client.records.get(dbName, tableName, nonExistentId)).rejects.toThrow(
      NotFoundError
    );
  });

  it('get should throw validation error for invalid recordId', async () => {
    await expect(client.records.get(dbName, tableName, 0)).rejects.toThrow(
      'Record ID must be a positive integer.'
    );
    await expect(client.records.get(dbName, tableName, -5)).rejects.toThrow(
      'Record ID must be a positive integer.'
    );
    await expect(client.records.get(dbName, tableName, 1.5)).rejects.toThrow(
      'Record ID must be a positive integer.'
    );
    await expect(client.records.get(dbName, tableName, 'abc' as any)).rejects.toThrow(
      'Record ID must be a positive integer.'
    );
  });

  // --- Update Record ---
  it('update should PUT partial data and return full updated record', async () => {
    const updatePayload: UpdateRecordPayload = { active: false, value: 150 };
    const expectedResponse: RecordResponse = {
      ...sampleRecordResponse,
      ...updatePayload,
    }; // Merged data

    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .put(`${basePath}/${recordId}`, updatePayload)
      .reply(200, expectedResponse);

    const result = await client.records.update(dbName, tableName, recordId, updatePayload);
    expect(result).toEqual(expectedResponse);
    expect(nock.isDone()).toBe(true);
  });

  it('update should throw BadRequestError on 400 (schema mismatch)', async () => {
    const updatePayload: UpdateRecordPayload = { value: 'not-a-number' };
    const errorResponse = { error: 'Invalid type for column: value' };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .put(`${basePath}/${recordId}`, updatePayload)
      .reply(400, errorResponse);

    await expect(client.records.update(dbName, tableName, recordId, updatePayload)).rejects.toThrow(
      BadRequestError
    );
  });

  it('update should throw NotFoundError on 404 (record not found)', async () => {
    const updatePayload: UpdateRecordPayload = { active: true };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .put(`${basePath}/${recordId}`, updatePayload)
      .reply(404, { error: 'Record not found' });

    await expect(client.records.update(dbName, tableName, recordId, updatePayload)).rejects.toThrow(
      NotFoundError
    );
  });

  it('update should throw validation error for empty payload', async () => {
    await expect(client.records.update(dbName, tableName, recordId, {})).rejects.toThrow(
      'Update payload cannot be empty.'
    );
  });

  // --- Delete Record ---
  it('delete should send DELETE request for the record ID', async () => {
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${basePath}/${recordId}`)
      .reply(204); // No content

    await expect(client.records.delete(dbName, tableName, recordId)).resolves.toBeUndefined();
    expect(nock.isDone()).toBe(true);
  });

  it('delete should throw NotFoundError on 404 (record not found)', async () => {
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${basePath}/${recordId}`)
      .reply(404, { error: 'Record not found' });

    await expect(client.records.delete(dbName, tableName, recordId)).rejects.toThrow(NotFoundError);
  });

  it('delete should throw validation error for invalid recordId', async () => {
    await expect(client.records.delete(dbName, tableName, 0)).rejects.toThrow(
      'Record ID must be a positive integer.'
    );
  });

  // --- General Module Auth Test ---
  it('should throw AuthError if token is missing/invalid for any operation', async () => {
    client.setAuthToken(null); // No token
    nock(mockBaseURL)
      .get(basePath) // Example: list operation
      .reply(401, { error: 'Token required' });

    await expect(client.records.list(dbName, tableName)).rejects.toThrow(AuthError);

    // Restore token for other tests if needed within this file (though afterAll handles it)
    client.setAuthToken(token);
  });
});
