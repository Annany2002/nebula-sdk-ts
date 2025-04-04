// test/http.test.ts
import nock from "nock";
import { makeRequest } from "../src/http"; // Adjust path as needed
import { NebulaClientConfig } from "../src/types";
import {
  ApiError,
  NetworkError,
  TimeoutError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  RateLimitError,
  ServerError,
} from "../src/errors";

const mockBaseURL = "http://testhost.com/api";
const mockConfig: NebulaClientConfig = { baseURL: mockBaseURL };
const mockContext = (token: string | null = null) => ({
  ...mockConfig,
  authToken: token,
  timeout: 500, // Use shorter timeout for testing
  fetch: fetch, // Assuming native fetch
});

describe("makeRequest HTTP Client", () => {
  afterEach(() => {
    nock.cleanAll(); // Clean up nock mocks after each test
  });

  it("should make a GET request successfully", async () => {
    const path = "/resource/1";
    const expectedData = { id: 1, name: "Test" };
    nock(mockBaseURL).get(path).reply(200, expectedData);

    const result = await makeRequest<typeof expectedData>(
      path,
      "GET",
      mockContext(),
    );
    expect(result).toEqual(expectedData);
    expect(nock.isDone()).toBe(true);
  });

  it("should make a POST request with body successfully", async () => {
    const path = "/resource";
    const requestBody = { name: "New Item" };
    const expectedData = { id: 2, name: "New Item" };
    nock(mockBaseURL).post(path, requestBody).reply(201, expectedData);

    const result = await makeRequest<typeof expectedData>(
      path,
      "POST",
      mockContext(),
      undefined,
      requestBody,
    );
    expect(result).toEqual(expectedData);
    expect(nock.isDone()).toBe(true);
  });

  it("should handle query parameters correctly", async () => {
    const path = "/items";
    const queryParams = { category: "books", limit: 10, available: true };
    const expectedData = [{ id: 3, name: "TS Handbook" }];
    // Nock matches query params automatically
    nock(mockBaseURL).get(path).query(queryParams).reply(200, expectedData);

    const result = await makeRequest<typeof expectedData>(
      path,
      "GET",
      mockContext(),
      queryParams,
    );
    expect(result).toEqual(expectedData);
    expect(nock.isDone()).toBe(true);
  });

  it("should handle 204 No Content response", async () => {
    const path = "/resource/1";
    nock(mockBaseURL).delete(path).reply(204);

    const result = await makeRequest<void>(path, "DELETE", mockContext());
    expect(result).toBeNull(); // makeRequest returns null for 204
    expect(nock.isDone()).toBe(true);
  });

  // --- Authentication Header ---
  it("should NOT include Authorization header when token is null", async () => {
    const path = "/secure/resource";
    nock(mockBaseURL)
      .get(path)
      .matchHeader("Authorization", (val) => val === undefined) // Expect header NOT present
      .reply(200, { success: true });

    await makeRequest(path, "GET", mockContext(null));
    expect(nock.isDone()).toBe(true);
  });

  it("should include Authorization header when token is provided", async () => {
    const path = "/secure/resource";
    const token = "my.test.token";
    nock(mockBaseURL)
      .get(path)
      .matchHeader("Authorization", `Bearer ${token}`) // Expect header present and correct
      .reply(200, { success: true });

    await makeRequest(path, "GET", mockContext(token));
    expect(nock.isDone()).toBe(true);
  });

  // --- Error Handling ---
  test.each([
    [400, BadRequestError, "Bad Request"],
    [401, AuthError, "Unauthorized"],
    [403, ForbiddenError, "Forbidden"],
    [404, NotFoundError, "Not Found"],
    [429, RateLimitError, "Too Many Requests"],
    [500, ServerError, "Internal Server Error"],
    [503, ServerError, "Service Unavailable"],
  ])(
    "should throw %p error for status %i",
    async (status, ExpectedError, apiMsg) => {
      const path = "/error/path";
      const errorResponse = { error: apiMsg, details: "Some details" };
      nock(mockBaseURL).get(path).reply(status, errorResponse);

      await expect(makeRequest(path, "GET", mockContext())).rejects.toThrow(
        ExpectedError,
      );
      await expect(
        makeRequest(path, "GET", mockContext()),
      ).rejects.toMatchObject({
        statusCode: status,
        errorData: errorResponse,
        message: expect.stringContaining(apiMsg), // Check if message includes API error
      });
      expect(nock.isDone()).toBe(true); // Ensure only one call was made per expect
      nock.cleanAll(); // Clean up for next iteration if needed within the same test run
    },
  );

  it("should throw NetworkError for fetch failures", async () => {
    const path = "/resource";
    nock(mockBaseURL).get(path).replyWithError("Network connection refused");

    await expect(makeRequest(path, "GET", mockContext())).rejects.toThrow(
      NetworkError,
    );
    await expect(makeRequest(path, "GET", mockContext())).rejects.toMatchObject(
      {
        message: expect.stringContaining("Failed to fetch"),
        cause: expect.anything(), // Check if original error is attached
      },
    );
  });

  it("should throw TimeoutError when request times out", async () => {
    const path = "/slow/resource";
    nock(mockBaseURL)
      .get(path)
      .delayConnection(mockContext().timeout + 100)
      .reply(200, {}); // Delay longer than timeout

    await expect(makeRequest(path, "GET", mockContext())).rejects.toThrow(
      TimeoutError,
    );
    await expect(makeRequest(path, "GET", mockContext())).rejects.toMatchObject(
      {
        message: expect.stringContaining("timed out"),
      },
    );
    expect(nock.isDone()).toBe(false); // Request was aborted, so nock wasn't fully satisfied
    nock.abortPendingRequests(); // Clean up pending request for timeout tests
  });

  it("should throw ApiError for unhandled client/server errors", async () => {
    const path = "/weird/error";
    const status = 418; // I'm a teapot
    const errorResponse = { error: "I'm a teapot" };
    nock(mockBaseURL).get(path).reply(status, errorResponse);

    await expect(makeRequest(path, "GET", mockContext())).rejects.toThrow(
      ApiError,
    );
    await expect(makeRequest(path, "GET", mockContext())).rejects.not.toThrow(
      ServerError,
    ); // Ensure it's not wrongly classified
    await expect(makeRequest(path, "GET", mockContext())).rejects.toMatchObject(
      {
        statusCode: status,
        errorData: errorResponse,
      },
    );
  });

  it("should handle non-JSON error responses gracefully", async () => {
    const path = "/html/error";
    const status = 500;
    const errorBody = "<html><body><h1>Server Error</h1></body></html>";
    nock(mockBaseURL)
      .get(path)
      .reply(status, errorBody, { "Content-Type": "text/html" });

    await expect(makeRequest(path, "GET", mockContext())).rejects.toThrow(
      ServerError,
    );
    await expect(makeRequest(path, "GET", mockContext())).rejects.toMatchObject(
      {
        statusCode: status,
        // errorData might be constructed differently here, check makeRequest logic
        errorData: {
          error: `Received status ${status} with invalid JSON body.`,
        },
        message: expect.stringContaining(`Received status ${status}`),
      },
    );
  });
});
