// src/types/auth.ts

import { User } from './common';

/** User credentials for signup */
export interface SignUpCredentials {
  email: string;
  password: string;
  username: string;
}

/** User credentials for login */
export interface LoginCredentials {
  email: string;
  password: string;
}

/** Response from a successful login request */
export interface LoginResponse {
  token: string;
  message: string;
  user: User;
}

/** Signup creates an account; log in separately to obtain a JWT. */
export interface SignupResponse {
  message: string;
  user_id: string;
  verification_required?: boolean;
  /** SMTP acceptance only; neither value guarantees inbox delivery. */
  verification_delivery?: 'sent' | 'unconfirmed';
}

export type UserInfo = User;

/** Response differs between API-key and JWT authentication. */
export type ProtectedHealthResponse =
  | { authenticated_by: 'api_key'; status: 'ok' }
  | { userId: string; dbId: null };

/** Payload for updating user profile */
export interface UpdateProfilePayload {
  username?: string;
  email?: string;
  /** Required by verification-enabled servers when changing email. */
  current_password?: string;
}

/** Response from a successful profile update */
export interface UserProfileResponse {
  message: string;
  user: UserInfo;
}

/** HTTP 202: the current email and session remain active until confirmation. */
export interface PendingEmailChangeResponse {
  message: string;
  pending_email: string;
}

/** Narrow with 'pending_email' in response before reading an updated user. */
export type UpdateProfileResponse = UserProfileResponse | PendingEmailChangeResponse;

export interface EmailChangePayload {
  email: string;
  current_password: string;
}

/** Public verification/resend acknowledgements never contain a login session. */
export interface EmailVerificationResponse {
  message: string;
}

export interface AuthRequestOptions {
  /** Cancels waiting only; the server may already have processed a write. */
  signal?: AbortSignal;
  /** Total request deadline, including the response body, in milliseconds. */
  timeout?: number;
}

/** A reset request never authenticates the caller or confirms inbox delivery. */
export interface PasswordRecoveryResponse {
  message: string;
}

/** Submit only the opaque token from the email fragment, never the full reset URL. */
export interface PasswordResetPayload {
  token: string;
  password: string;
}
