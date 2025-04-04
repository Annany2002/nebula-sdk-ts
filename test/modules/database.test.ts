// test/modules/database.test.ts
import nock from "nock";
import { NebulaClient } from "../../src/client";
import {
  DbCreatePayload,
  DbInfoResponse,
  DbListResponse,
} from "../../src/types";
import { AuthError, BadRequestError, NotFoundError } from "../../src/errors";

const mockBaseURL = "http://api.nebula-test.com"; // Use a distinct URL for module tests
const client = new NebulaClient({ baseURL: mockBaseURL });
const token = "valid-token-for-db-tests";

describe("DatabaseModule", () => {
  const databasesPath = "/api/v1/databases";

  beforeAll(() => {
    // Set token for all tests in this suite
    client.setAuthToken(token);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    client.setAuthToken(null); // Clean up token
  });

  // --- Create Database ---
  it("create should POST database name and return info", async () => {
    const payload: DbCreatePayload = { db_name: "new_db" };
    const expectedResponse: DbInfoResponse = {
      db_name: "new_db",
      message: "Database created",
    };

    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(databasesPath, JSON.stringify(payload))
      .reply(201, expectedResponse);

    const result = await client.databases.create(payload);
    expect(result).toEqual(expectedResponse);
    expect(nock.isDone()).toBe(true);
  });

  it("create should throw BadRequestError on 400 (e.g., name exists)", async () => {
    const payload: DbCreatePayload = { db_name: "existing_db" };
    const errorResponse = { error: "Database name already exists" };

    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .post(databasesPath, JSON.stringify(payload))
      .reply(400, errorResponse);

    await expect(client.databases.create(payload)).rejects.toThrow(
      BadRequestError,
    );
    await expect(client.databases.create(payload)).rejects.toMatchObject({
      errorData: errorResponse,
    });
  });

  it("create should throw AuthError on 401", async () => {
    client.setAuthToken("invalid-token"); // Temporarily use invalid token
    const payload: DbCreatePayload = { db_name: "another_db" };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer invalid-token` } })
      .post(databasesPath, JSON.stringify(payload))
      .reply(401, { error: "Invalid token" });

    await expect(client.databases.create(payload)).rejects.toThrow(AuthError);
    client.setAuthToken(token); // Restore valid token
  });

  it("create should throw validation error if db_name is missing", async () => {
    await expect(client.databases.create({} as any)).rejects.toThrow(
      "Database name (db_name) is required.",
    );
    await expect(
      client.databases.create({ db_name: "" } as any),
    ).rejects.toThrow("Database name (db_name) is required.");
  });

  // --- List Databases ---
  it("list should GET database names", async () => {
    const expectedResponse: DbListResponse = {
      databases: ["db1", "db2", "new_db"],
    };
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .get(databasesPath)
      .reply(200, expectedResponse);

    const result = await client.databases.list();
    expect(result).toEqual(expectedResponse);
    expect(nock.isDone()).toBe(true);
  });

  it("list should throw AuthError on 401", async () => {
    client.setAuthToken(null); // Temporarily clear token
    nock(mockBaseURL) // No auth header expected
      .get(databasesPath)
      .reply(401, { error: "Token required" });

    await expect(client.databases.list()).rejects.toThrow(AuthError);
    client.setAuthToken(token); // Restore valid token
  });

  // --- Delete Database ---
  it("delete should send DELETE request for the database name", async () => {
    const dbName = "db_to_delete";
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${databasesPath}/${dbName}`)
      .reply(204); // No content

    await expect(client.databases.delete(dbName)).resolves.toBeUndefined();
    expect(nock.isDone()).toBe(true);
  });

  it("delete should URL encode database name", async () => {
    const dbName = "db with spaces";
    const encodedDbName = encodeURIComponent(dbName);
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${databasesPath}/${encodedDbName}`)
      .reply(204);

    await expect(client.databases.delete(dbName)).resolves.toBeUndefined();
    expect(nock.isDone()).toBe(true);
  });

  it("delete should throw NotFoundError on 404", async () => {
    const dbName = "non_existent_db";
    nock(mockBaseURL, { reqheaders: { Authorization: `Bearer ${token}` } })
      .delete(`${databasesPath}/${dbName}`)
      .reply(404, { error: "Database not found" });

    await expect(client.databases.delete(dbName)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("delete should throw validation error if dbName is missing", async () => {
    await expect(client.databases.delete("")).rejects.toThrow(
      "Database name is required for deletion.",
    );
    await expect(client.databases.delete(null as any)).rejects.toThrow(
      "Database name is required for deletion.",
    );
  });
});
