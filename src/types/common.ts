// src/types/common.ts

/** Standard structure for API error responses from Nebula */
export interface NebulaErrorResponse {
  error: string;
  details?: string | Record<string, any>; // Reflecting potential variations
}
