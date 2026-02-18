// src/types/record.ts

/** Represents the data within a single record (flexible key-value pairs) */
export type RecordData = Record<string, any>; // Allows any structure

/** Payload for creating a new record (simply the data itself) */
export type CreateRecordPayload = RecordData;

/** Payload for updating an existing record (can be partial) */
export type UpdateRecordPayload = Partial<RecordData>;

/** Represents a record retrieved from the API, including its system-assigned ID */
export interface RecordResponse extends RecordData {
  /** The unique identifier for the record (assuming number from SQLite) */
  id: number;
}

/** Type for basic equality filtering parameters used in list operations */
export type FilterParams = Record<string, string | number | boolean>;

/** Options for pagination, sorting, and field selection in list operations */
export interface ListOptions {
  /** Maximum number of records to return (1-1000, default: 100) */
  limit?: number;
  /** Number of records to skip (default: 0) */
  offset?: number;
  /** Column name to sort by */
  sort?: string;
  /** Sort direction: 'asc' or 'desc' (default: 'asc') */
  order?: 'asc' | 'desc';
  /** Comma-separated list of column names to return */
  fields?: string;
}
