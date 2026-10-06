export interface IndexInfo {
  name: string;
  tableName: string;
  unique: boolean;
  /** Original CREATE INDEX statement. */
  sql: string;
}

export interface TriggerInfo {
  name: string;
  /** Target table or view name. */
  tableName: string;
  /** Original CREATE TRIGGER statement. */
  sql: string;
}

/** Custom index and trigger catalog; tables, views, and SQLite automatic indexes are excluded. */
export interface DatabaseObjects {
  indexes: IndexInfo[];
  triggers: TriggerInfo[];
}
