export type ForeignKeyAction = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

export interface ForeignKeyDefinition {
  target_table: string;
  target_column: string;
  on_delete?: ForeignKeyAction;
  on_update?: ForeignKeyAction;
}

export interface ForeignKeyTableConstraint extends ForeignKeyDefinition {
  column: string;
}

export interface ColumnDefinition {
  name: string;
  /** TEXT, INTEGER, REAL, BLOB, BOOLEAN, DATETIME or NUMERIC (case insensitive). */
  type: string;
  foreign_key?: ForeignKeyDefinition;
}

/** The backend accepts either columns or its legacy schema alias. */
export type SchemaPayload = {
  table_name: string;
  foreign_keys?: ForeignKeyTableConstraint[];
} & (
  | { columns: ColumnDefinition[]; schema?: ColumnDefinition[] }
  | { schema: ColumnDefinition[]; columns?: ColumnDefinition[] }
);

export interface SchemaCreateResponse {
  message: string;
  db_name: string;
  table_name: string;
}

/** Simplified CREATE TABLE metadata; constraint entries can also appear in this list. */
export interface SchemaColumn {
  name: string;
  type: string;
  pk: boolean;
}

export interface SchemaInfoResponse {
  schema: SchemaColumn[];
}

/** SQLite PRAGMA table_info metadata returned by listTables, distinct from getSchema. */
export interface TableColumnInfo {
  cid: string;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface TableListResponseType {
  type: string;
  name: string;
  tbl_name: string;
  rootpage: string;
  sql: string;
  createdAt: string;
  rowCount: number;
  columns: TableColumnInfo[];
}

export interface TableListResponse {
  tables: TableListResponseType[];
}
