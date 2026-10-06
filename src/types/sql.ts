/** Raw SQL result. Row values follow the order of columns, not object property names. */
export interface SQLQueryResult<TRow extends unknown[] = unknown[]> {
  /** May be omitted for statements or queries without result columns. */
  columns?: string[];
  /** May be omitted for empty results. A row generic does not validate server data. */
  rows?: TRow[];
  rowCount: number;
  rowsAffected: number;
  executionMs: number;
  message?: string;
}
