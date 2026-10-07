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

export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';
export type TriggerTiming = 'AFTER' | 'BEFORE';

/** Native table triggers; INSTEAD OF triggers on views use SQL execution. */
export interface CreateTriggerPayload {
  /** 1–64 ASCII letters, digits, or underscores; sqlite_ and _nebula_ prefixes are reserved. */
  name: string;
  /** Existing ordinary user table; quoted table names are supported. */
  table_name: string;
  event: TriggerEvent;
  /** Defaults to AFTER when omitted. */
  timing?: TriggerTiming;
  /** Up to 64 distinct writable columns, only for UPDATE; omitted/empty means all columns. */
  update_of?: string[];
  /** Optional SQL condition, at most 8 KiB of UTF-8 text, without NUL. */
  when?: string;
  /** Semicolon-terminated SQL statements, without the CREATE TRIGGER / BEGIN / END wrapper.
   * At most 64 KiB of UTF-8 text, without NUL. The server validates SQL and references.
   */
  body: string;
}

export interface CreateTriggerResponse {
  message: string;
  db_name: string;
  trigger: TriggerInfo;
}

export interface DropTriggerResponse {
  message: string;
  db_name: string;
  /** Stored canonical name, including for case-insensitive or legacy quoted-name lookup. */
  trigger_name: string;
}
