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
}

/** Response from a successful profile update */
export interface UserProfileResponse {
  message: string;
  user: UserInfo;
}
