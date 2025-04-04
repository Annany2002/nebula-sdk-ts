// src/types/auth.ts

/** User credentials for signup or login */
export interface Credentials {
  email: string;
  password: string;
}

/** Response from a successful login request */
export interface LoginResponse {
  token: string;
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
  userId: string; // Assuming /me endpoint returns at least this
}
