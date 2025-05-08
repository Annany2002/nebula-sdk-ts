// src/modules/auth.ts
import { makeRequest } from '../http';
import {
  SignUpCredentials,
  LoginResponse,
  SignupResponse,
  UserInfo,
  LoginCredentials,
} from '../types';
import { ModuleContext } from './_common';

export class AuthModule {
  private context: ModuleContext;

  constructor(context: ModuleContext) {
    this.context = context;
  }

  private getRequestContext() {
    return {
      ...this.context.config,
      authToken: this.context.getAuthToken(), // Get current token for the request
    };
  }

  /**
   * Registers a new user account.
   * @param credentials - User email, username and password.
   * @returns A promise that resolves upon successful signup (response body depends on API).
   * @throws {BadRequestError} If email/password format is invalid or email is taken.
   * @throws {ApiError} For other API-related errors.
   * @throws {NetworkError} If the request fails to send.
   */
  async signup(credentials: SignUpCredentials): Promise<SignupResponse> {
    // Note: No auth token needed for signup
    const requestContext = { ...this.context.config, authToken: null };
    return makeRequest<SignupResponse>(
      'auth/signup',
      'POST',
      requestContext,
      undefined,
      credentials
    );
  }

  /**
   * Logs in a user and returns a JWT token.
   * The returned token should be stored securely and set on the client instance
   * using `client.setAuthToken(response.token)`.
   * @param credentials - User email and password.
   * @returns An object containing the JWT token.
   * @throws {AuthError} If credentials are invalid (typically 401).
   * @throws {BadRequestError} If email/password format is invalid.
   * @throws {ApiError} For other API-related errors.
   * @throws {NetworkError} If the request fails to send.
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    // Note: No auth token needed for login
    const requestContext = { ...this.context.config, authToken: null };
    return makeRequest<LoginResponse>('auth/login', 'POST', requestContext, undefined, credentials);
  }

  /**
   * Health route to check health of the protected routes
   * Requires an api key
   * @returns A void Promise
   */

  async healthP(): Promise<void> {
    return makeRequest('api/v1/health', 'GET', this.getRequestContext());
  }

  /**
   * Fetches basic information about the currently authenticated user.
   * Requires a valid token to be set on the client via `setAuthToken`.
   * @returns User information (exact content depends on API's /api/v1/me endpoint).
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   * @throws {NetworkError} If the request fails to send.
   */
  async getMe(): Promise<UserInfo> {
    // This request requires authentication
    return makeRequest<UserInfo>('api/v1/me', 'GET', this.getRequestContext());
  }
}
