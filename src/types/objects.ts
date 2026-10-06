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

/** Ordered column indexes; expressions, partial predicates, and collations use SQL execution. */
export interface CreateIndexPayload {
  /** 1–64 ASCII letters, digits, or underscores; sqlite_ and _nebula_ prefixes are reserved. */
  name: string;
  table_name: string;
  /** One to 64 existing columns, in composite index order. */
  columns: string[];
  /** Defaults to false. Existing duplicate values cause a conflict when true. */
  unique?: boolean;
}

export interface CreateIndexResponse {
  message: string;
  db_name: string;
  index: IndexInfo;
}

export interface DropIndexResponse {
  message: string;
  db_name: string;
  index_name: string;
}
