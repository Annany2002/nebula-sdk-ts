// src/modules/auth.ts
import { makeRequest, RequestAuthentication, RequestContext } from '../http';
import {
  AuthRequestOptions,
  EmailChangePayload,
  EmailVerificationResponse,
  SignUpCredentials,
  LoginResponse,
  SignupResponse,
  UserInfo,
  LoginCredentials,
  UpdateProfilePayload,
  UserProfileResponse,
  UpdateProfileResponse,
  ProtectedHealthResponse,
} from '../types';
import { ModuleContext } from './_common';
import { NebulaError } from '../errors';
import {
  authOptions,
  parseProfileUpdate,
  parseSignup,
  parseUser,
  parseVerificationResponse,
  validateEmail,
  validateVerificationToken,
} from './auth-validation';

export class AuthModule {
  private context: ModuleContext;

  constructor(context: ModuleContext) {
    this.context = context;
  }

  private getRequestContext(
    authentication: RequestAuthentication = 'auto',
    options: AuthRequestOptions = {}
  ): RequestContext {
    const { timeout, signal } = authOptions(options);
    return {
      ...this.context.config,
      timeout: timeout ?? this.context.config.timeout,
      signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      authentication,
      authToken: this.context.getAuthToken(), // Get current token for the request
    };
  }

  /**
   * Registers a new user account.
   * @param credentials - User email, username and password.
   * @returns The new user ID and optional verification/delivery status. No login session is created.
   * @throws {BadRequestError} If email/password format is invalid or email is taken.
   * @throws {ApiError} For other API-related errors.
   * @throws {NetworkError} If the request fails to send.
   */
  async signup(
    credentials: SignUpCredentials,
    options: AuthRequestOptions = {}
  ): Promise<SignupResponse> {
    // Note: No auth token needed for signup
    const requestContext = this.getRequestContext('none', options);
    return makeRequest<SignupResponse>(
      'auth/signup',
      'POST',
      requestContext,
      undefined,
      credentials,
      [201],
      parseSignup
    );
  }

  /**
   * Logs in a user and returns a JWT token.
   * The returned token should be stored securely and set on the client instance
   * using `client.setAuthToken(response.token)`.
   * @param credentials - User email and password.
   * @returns An object containing the JWT token.
   * @throws {AuthError} If credentials are invalid (typically 401).
   * @throws {ForbiddenError} With email_verification_required while verification is pending.
   * @throws {BadRequestError} If email/password format is invalid.
   * @throws {ApiError} For other API-related errors.
   * @throws {NetworkError} If the request fails to send.
   */
  async login(
    credentials: LoginCredentials,
    options: AuthRequestOptions = {}
  ): Promise<LoginResponse> {
    // Note: No auth token needed for login
    const requestContext = this.getRequestContext('none', options);
    return makeRequest<LoginResponse>(
      'auth/login',
      'POST',
      requestContext,
      undefined,
      credentials,
      [200]
    );
  }

  /** Confirm a single-use token explicitly. Does not sign in or mutate the client's stored JWT. */
  async verifyEmail(
    token: string,
    options: AuthRequestOptions = {}
  ): Promise<EmailVerificationResponse> {
    validateVerificationToken(token);
    return makeRequest(
      'auth/verify-email',
      'POST',
      this.getRequestContext('none', options),
      undefined,
      { token },
      [200],
      parseVerificationResponse
    );
  }

  /** Generic acknowledgement for known/unknown addresses, not a delivery guarantee. Never retries. */
  async resendVerification(
    email: string,
    options: AuthRequestOptions = {}
  ): Promise<EmailVerificationResponse> {
    validateEmail(email);
    return makeRequest(
      'auth/resend-verification',
      'POST',
      this.getRequestContext('none', options),
      undefined,
      { email },
      [202],
      parseVerificationResponse
    );
  }

  /** Request an email change separately from username updates; confirmation revokes old JWTs. */
  async requestEmailChange(
    payload: EmailChangePayload,
    options: AuthRequestOptions = {}
  ): Promise<UpdateProfileResponse> {
    validateEmail(payload?.email);
    if (
      typeof payload.current_password !== 'string' ||
      !payload.current_password.length ||
      new TextEncoder().encode(payload.current_password).length > 72
    ) {
      throw new NebulaError('Provide your current password (at most 72 UTF-8 bytes).');
    }
    return this.updateProfile(
      { email: payload.email, current_password: payload.current_password },
      options
    );
  }

  /**
   * Health route to check health of the protected routes
   * Accepts a JWT session or database API key
   * @returns The authentication scheme or JWT user ID.
   */

  async healthP(): Promise<ProtectedHealthResponse> {
    return makeRequest<ProtectedHealthResponse>('api/v1/health', 'GET', this.getRequestContext());
  }

  /**
   * Fetches basic information about the currently authenticated user.
   * Requires a valid token to be set on the client via `setAuthToken`.
   * @returns User information including userId, username, email, and createdAt.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   * @throws {NetworkError} If the request fails to send.
   */
  async getMe(options: AuthRequestOptions = {}): Promise<UserInfo> {
    // This request requires authentication
    return makeRequest<UserInfo>(
      'api/v1/account/user/me',
      'GET',
      this.getRequestContext('bearer', options),
      undefined,
      undefined,
      [200],
      parseUser
    );
  }

  /**
   * Updates the profile of the currently authenticated user.
   * Requires a valid token to be set on the client via `setAuthToken`.
   * @param payload - Object containing fields to update (username and/or email).
   * @returns An updated user (200), or pending_email (202) while the current email stays active.
   * @throws {BadRequestError} If no fields are provided or values are invalid.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async updateProfile(
    payload: UpdateProfilePayload & { email?: never },
    options?: AuthRequestOptions
  ): Promise<UserProfileResponse>;
  async updateProfile(
    payload: UpdateProfilePayload,
    options?: AuthRequestOptions
  ): Promise<UpdateProfileResponse>;
  async updateProfile(
    payload: UpdateProfilePayload,
    options: AuthRequestOptions = {}
  ): Promise<UpdateProfileResponse> {
    if (!payload || (!payload.username && !payload.email)) {
      throw new Error("No fields to update. Provide 'username' or 'email'.");
    }
    const target = payload.email;
    return makeRequest<UpdateProfileResponse>(
      'api/v1/account/user/me',
      'PUT',
      this.getRequestContext('bearer', options),
      undefined,
      payload,
      [200, 202],
      (value, status) => parseProfileUpdate(value, status, target)
    );
  }

  /**
   * Finds a user by their user ID.
   * @param userId - The unique ID of the user to find.
   * @returns User information for the specified user.
   * @throws {NotFoundError} If no user exists with the given ID.
   * @throws {AuthError} If the token is missing, invalid, or expired.
   * @throws {ApiError} For other API-related errors.
   */
  async findUser(userId: string): Promise<UserInfo> {
    if (!userId) {
      throw new Error('User ID is required.');
    }
    return makeRequest<UserInfo>(
      `api/v1/user/${encodeURIComponent(userId)}`,
      'GET',
      this.getRequestContext('bearer')
    );
  }
}
