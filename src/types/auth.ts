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

/**
 * Response from a successful signup request.
 * NOTE: The Nebula API README doesn't specify the signup response.
 * Assuming void or a simple success message for now. Adjust if needed.
 */
export interface SignupResponse {
  message?: string; // Example: Adjust based on actual API response
  userId?: string; // Example: Adjust based on actual API response
  // Or could be simply `void` if nothing is returned on success
}

/** Placeholder for user information - adjust if /api/v1/me returns more */
export interface UserInfo {
  userId: string;
  username: string;
  email: string;
  createdAt: string;
}

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
