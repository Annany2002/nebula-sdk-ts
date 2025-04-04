// test/modules/auth.test.ts
import nock from "nock";
import { NebulaClient } from "../../src/client";
import {
  Credentials,
  LoginResponse,
  SignupResponse,
  UserInfo,
} from "../../src/types";
import { AuthError, BadRequestError } from "../../src/errors";

const mockBaseURL = "http://localhost:8080";
const client = new NebulaClient({ baseURL: mockBaseURL });

describe("AuthModule", () => {
  const signupPath = "/auth/signup";
  const loginPath = "/auth/login";
  const mePath = "/api/v1/me";

  const testCredentials: Credentials = {
    email: "test@example.com",
    password: "password123",
  };

  afterEach(() => {
    nock.cleanAll();
    client.setAuthToken(null); // Reset token state
  });

  // --- Signup ---
  it("signup should POST credentials successfully", async () => {
    // Assuming API returns 201 or 200 with simple message on success
    const mockSignupResponse: SignupResponse = {
      message: "User created successfully",
    };
    nock(mockBaseURL)
      .post(signupPath, JSON.stringify(testCredentials))
      .reply(201, mockSignupResponse);

    const response = await client.auth.signup(testCredentials);
    expect(response).toEqual(mockSignupResponse);
    expect(nock.isDone()).toBe(true);
  });

  it("signup should throw BadRequestError on 400 response", async () => {
    const errorResponse = { error: "Invalid email format" };
    nock(mockBaseURL)
      .post(signupPath, JSON.stringify(testCredentials))
      .reply(400, errorResponse);

    await expect(client.auth.signup(testCredentials)).rejects.toThrow(
      BadRequestError,
    );
    await expect(client.auth.signup(testCredentials)).rejects.toMatchObject({
      statusCode: 400,
      errorData: errorResponse,
    });
  });

  // --- Login ---
  it("login should POST credentials and return token", async () => {
    const mockLoginResponse: LoginResponse = { token: "returned.jwt.token" };
    nock(mockBaseURL)
      .post(loginPath, JSON.stringify(testCredentials))
      .reply(200, mockLoginResponse);

    const response = await client.auth.login(testCredentials);
    expect(response).toEqual(mockLoginResponse);
    expect(nock.isDone()).toBe(true);
    // Important: Login method itself should NOT set the token on the client
    expect(client.getAuthToken()).toBeNull();
  });

  it("login should throw AuthError on 401 response", async () => {
    const errorResponse = { error: "Invalid credentials" };
    nock(mockBaseURL)
      .post(loginPath, JSON.stringify(testCredentials))
      .reply(401, errorResponse);

    await expect(client.auth.login(testCredentials)).rejects.toThrow(AuthError);
    await expect(client.auth.login(testCredentials)).rejects.toMatchObject({
      statusCode: 401,
      errorData: errorResponse,
    });
  });

  // --- GetMe ---
  it("getMe should make GET request with auth token", async () => {
    const token = "valid.user.token";
    const mockUserInfo: UserInfo = { userId: "usr_123" }; // Adjust based on actual API response

    client.setAuthToken(token); // Set token before making the call

    nock(mockBaseURL)
      .get(mePath)
      .matchHeader("Authorization", `Bearer ${token}`)
      .reply(200, mockUserInfo);

    const response = await client.auth.getMe();
    expect(response).toEqual(mockUserInfo);
    expect(nock.isDone()).toBe(true);
  });

  it("getMe should throw AuthError if no token is set (simulated via http client check)", async () => {
    // We don't need nock here if http client throws before sending
    // However, the current http client *would* send without token, leading to API 401
    const errorResponse = { error: "Missing or invalid token" };
    nock(mockBaseURL)
      .get(mePath)
      // Expecting request *without* Authorization header
      .matchHeader("Authorization", (val) => val === undefined)
      .reply(401, errorResponse);

    // Ensure token is null
    client.setAuthToken(null);

    await expect(client.auth.getMe()).rejects.toThrow(AuthError);
    await expect(client.auth.getMe()).rejects.toMatchObject({
      statusCode: 401,
      errorData: errorResponse,
    });
  });

  it("getMe should throw AuthError if token is invalid (API 401)", async () => {
    const token = "invalid.or.expired.token";
    const errorResponse = { error: "Invalid token" };
    client.setAuthToken(token);

    nock(mockBaseURL)
      .get(mePath)
      .matchHeader("Authorization", `Bearer ${token}`)
      .reply(401, errorResponse);

    await expect(client.auth.getMe()).rejects.toThrow(AuthError);
    await expect(client.auth.getMe()).rejects.toMatchObject({
      statusCode: 401,
      errorData: errorResponse,
    });
  });
});
