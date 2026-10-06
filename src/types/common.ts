// src/types/common.ts

/** Standard structure for API error responses from Nebula */
export interface NebulaErrorResponse {
  error: string;
  details?: string | Record<string, unknown>; // Reflecting potential variations
}

export interface User {
  createdAt: string;
  email: string;
  userId: string;
  username: string;
}
