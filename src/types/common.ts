// src/types/common.ts

export type PlatformRole = 'user' | 'admin';

/** Standard structure for API error responses from Nebula */
export interface NebulaErrorResponse {
  error: string;
  /** Machine-readable server error code, when the endpoint provides one. */
  code?: string;
  details?: string | Record<string, unknown>; // Reflecting potential variations
}

export interface User {
  /** Current profile membership; omitted by older servers and the login response. */
  role?: PlatformRole;
  /** Optional on older servers. False does not by itself mean access is restricted. */
  email_verified?: boolean;
  verification_required?: boolean;
  /** Requested replacement; email remains the current address until confirmation. */
  pending_email?: string;
  createdAt: string;
  email: string;
  userId: string;
  username: string;
}
