// src/types/database.ts

/** Type for a DbListResponse */
export type DbListRType = {
  databaseId: number;
  userId: string;
  dbName: string;
  filePath: string;
  createdAt: string;
  tables: number;
  apiKeyPrefix?: string;
};

/** Response structure for listing databases */
export interface DbListResponse {
  databases: DbListRType[];
}

/** Live database details; sizeBytes is the main database file size, excluding WAL/SHM files. */
export interface DatabaseDetails extends DbListRType {
  totalRecords: number;
  sizeBytes: number;
  sizeDisplay: string;
}

export interface DatabaseDetailsResponse {
  database: DatabaseDetails;
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

/** A standalone SQLite snapshot, imported into a new database using the owner's JWT. */
export interface SQLiteImportPayload {
  /** New name: 1–64 ASCII letters, digits or underscores. Existing databases are never replaced. */
  db_name: string;
  /** Browser File/Blob or buffered bytes (including Node Buffer); at most 64 MiB. */
  file: Blob | Uint8Array;
}

export interface SQLiteImportOptions {
  /** Cancels this request only. Check the database list before retrying an interrupted import. */
  signal?: AbortSignal;
  /** Request deadline in milliseconds, including the upload and response body. Defaults to the client timeout. */
  timeout?: number;
}

/** Acknowledgement after the snapshot and its database registration are committed. */
export interface SQLiteImportResponse {
  message: string;
  db_name: string;
  /** Uploaded snapshot length; later database writes may change its size. */
  size_bytes: number;
}

/** Response structure for API key operations */
export interface ApiKeyResponse {
  api_key: string;
  message?: string;
}

/** GET returns credential metadata. Only createApiKey returns the full secret. */
export interface ApiKeyMetadataResponse {
  key_prefix: string;
  created_at: string;
}
