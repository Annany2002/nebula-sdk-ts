// src/types/database.ts

/** Type for a DbListResponse */
export type DbListRType = {
  databaseId: number;
  userId: string;
  dbName: string;
  filePath: string;
  createdAt: string;
  tables: number;
  apiKey: string;
};

/** Response structure for listing databases */
export interface DbListResponse {
  databases: DbListRType[];
}

/** Payload for creating a new database */
export interface DbCreatePayload {
  db_name: string;
}

/** Response structure after creating a database */
export interface DbInfoResponse {
  db_name: string;
  message: string;
}

/** Response structure for API key operations */
export interface ApiKeyResponse {
  api_key: string;
  message?: string;
}
