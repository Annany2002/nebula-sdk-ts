// src/modules/auth.ts
import { makeMultipartRequest, makeRequest, RequestAuthentication, RequestContext } from '../http';
import {
  AuthProvidersResponse,
  GitHubStartPayload,
  GitHubLinkStartPayload,
  GitHubAuthorizationResponse,
  GitHubCallbackPayload,
  GitHubLinkResponse,
  AuthRequestOptions,
  PasswordResetPayload,
  PasswordRecoveryResponse,
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
  validatePasswordReset,
  validateVerificationToken,
} from './auth-validation';

import {
  validateGitHubStart,
  validateGitHubCallback,
  parseAuthProviders,
  parseGitHubAuthorization,
  parseGitHubLogin,
  parseGitHubLink,
} from './github-validation';

import { avatarForm, confirmAvatarResult } from './avatar-validation';

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

  /** Discover enabled providers. Older backends may return NotFoundError. No credentials are sent. */
  async getProviders(options: AuthRequestOptions = {}): Promise<AuthProvidersResponse> {
    return makeRequest(
      'auth/providers',
      'GET',
      this.getRequestContext('none', options),
      undefined,
      undefined,
      [200],
      parseAuthProviders
    );
  }

  /** Start with an S256 challenge; the caller owns verifier storage, state comparison and navigation. */
  async startGitHubSignIn(
    payload: GitHubStartPayload,
    options: AuthRequestOptions = {}
  ): Promise<GitHubAuthorizationResponse> {
    validateGitHubStart(payload);
    const challenge = payload.code_challenge;
    return makeRequest(
      'auth/github/start',
      'POST',
      this.getRequestContext('none', options),
      undefined,
      { code_challenge: challenge },
      [200],
      (value) => parseGitHubAuthorization(value, challenge)
    );
  }

  /** One code exchange, with no retries or automatic change to the client's stored JWT. */
  async completeGitHubSignIn(
    payload: GitHubCallbackPayload,
    options: AuthRequestOptions = {}
  ): Promise<LoginResponse> {
    validateGitHubCallback(payload);
    return makeRequest(
      'auth/github/callback',
      'POST',
      this.getRequestContext('none', options),
      undefined,
      { code: payload.code, state: payload.state, code_verifier: payload.code_verifier },
      [200],
      parseGitHubLogin
    );
  }

  /** Requires the owner's current JWT and password; a database API key cannot substitute for a JWT. */
  async startGitHubLink(
    payload: GitHubLinkStartPayload,
    options: AuthRequestOptions = {}
  ): Promise<GitHubAuthorizationResponse> {
    validateGitHubStart(payload, true);
    const challenge = payload.code_challenge;
    return makeRequest(
      'api/v1/account/identities/github/start',
      'POST',
      this.getRequestContext('bearer', options),
      undefined,
      { code_challenge: challenge, current_password: payload.current_password },
      [200],
      (value) => parseGitHubAuthorization(value, challenge)
    );
  }

  /** Complete a linking attempt once. Clear the stored JWT after success and sign in again. */
  async completeGitHubLink(
    payload: GitHubCallbackPayload,
    options: AuthRequestOptions = {}
  ): Promise<GitHubLinkResponse> {
    validateGitHubCallback(payload);
    return makeRequest(
      'auth/github/callback',
      'POST',
      this.getRequestContext('none', options),
      undefined,
      { code: payload.code, state: payload.state, code_verifier: payload.code_verifier },
      [200],
      parseGitHubLink
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

  /** Request a reset email. The generic acknowledgement is not an account or delivery oracle. */
  async forgotPassword(
    email: string,
    options: AuthRequestOptions = {}
  ): Promise<PasswordRecoveryResponse> {
    validateEmail(email);
    return makeRequest(
      'auth/forgot-password',
      'POST',
      this.getRequestContext('none', options),
      undefined,
      { email },
      [202],
      parseVerificationResponse
    );
  }

  /** Reset explicitly without retries or automatic sign-in. Clear any stored JWT after success. */
  async resetPassword(
    payload: PasswordResetPayload,
    options: AuthRequestOptions = {}
  ): Promise<PasswordRecoveryResponse> {
    validatePasswordReset(payload);
    return makeRequest(
      'auth/reset-password',
      'POST',
      this.getRequestContext('none', options),
      undefined,
      { token: payload.token, password: payload.password },
      [200],
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

  /** Uploads a public profile photo. The server validates and normalizes it; filenames are ignored. */
  async uploadAvatar(file: Blob, options: AuthRequestOptions = {}): Promise<UserInfo> {
    const context = this.getRequestContext('bearer', options);
    const response = await makeMultipartRequest<unknown>(
      'api/v1/account/user/me/avatar',
      context,
      avatarForm(file),
      200
    );
    return confirmAvatarResult(parseUser(response), 'upload');
  }

  /** Removes the photo and preserves the explicit choice across later GitHub sign-ins. */
  async removeAvatar(options: AuthRequestOptions = {}): Promise<UserInfo> {
    return makeRequest<UserInfo>(
      'api/v1/account/user/me/avatar',
      'DELETE',
      this.getRequestContext('bearer', options),
      undefined,
      undefined,
      [200],
      (value) => confirmAvatarResult(parseUser(value), 'remove')
    );
  }

  /** Marks optional onboarding complete, including skipping photo setup. Does not change the avatar. */
  async completeOnboarding(options: AuthRequestOptions = {}): Promise<UserInfo> {
    return makeRequest<UserInfo>(
      'api/v1/account/user/me/onboarding',
      'POST',
      this.getRequestContext('bearer', options),
      undefined,
      undefined,
      [200],
      (value) => confirmAvatarResult(parseUser(value), 'onboard')
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
