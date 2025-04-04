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
