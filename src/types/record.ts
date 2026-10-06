/** Column values returned by the backend; no particular primary-key name is assumed. */
export type RecordData = Record<string, unknown>;
export type CreateRecordPayload = RecordData;
export type UpdateRecordPayload = Partial<RecordData>;
export type RecordResponse = RecordData;

/** Numeric or text primary-key value. Use strings for integers outside JS's safe range. */
export type RecordId = string | number;

/** Create and update return an acknowledgement, not a full row. */
export interface RecordMutationResponse {
  message: string;
  record_id: RecordId;
}

export interface RecordPagination {
  total: number;
  limit: number;
  offset: number;
}

export interface RecordListResponse<T extends object = RecordResponse> {
  records: T[];
  pagination: RecordPagination;
}

/** Equality filters. Reserved list option names cannot be used as column filters. */
export type FilterParams = Record<string, string | number | boolean>;

export interface ListOptions {
  /** Maximum number of records to return (1–1000, default: 100). */
  limit?: number;
  /** Number of records to skip (default: 0). */
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  /** Comma-separated column names; omitted fields will not be present in returned rows. */
  fields?: string;
}
