/** JSON response from the SQL dump endpoint. */
export interface SQLExport {
  sql: string;
  filename: string;
}

/** A buffered SQLite snapshot; the SDK does not write files or start browser downloads. */
export interface SQLiteExport {
  data: Uint8Array;
  /** Suggested filename derived from the database name, independent of CORS-exposed headers. */
  filename: string;
}
