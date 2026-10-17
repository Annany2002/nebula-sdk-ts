// src/types/common.ts

/** Standard structure for API error responses from Nebula */
export interface NebulaErrorResponse {
  error: string;
  /** Machine-readable server error code, when the endpoint provides one. */
  code?: string;
  details?: string | Record<string, unknown>; // Reflecting potential variations
}

export interface User {
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
