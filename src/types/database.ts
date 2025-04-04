// src/types/database.ts

/** Payload for creating a new database registration */
export interface DbCreatePayload {
  db_name: string;
}

/** Assumed response structure after creating a database */
export interface DbInfoResponse {
  db_name: string;
  message?: string; // Example field, adjust if API differs
}

/** Assumed response structure for listing databases */
export interface DbListResponse {
  databases: string[];
}
