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

export interface AlterColumnDefinition extends ColumnDefinition {
  /** SQLite default expression, such as "0" or "'draft'"; null is treated as omitted. */
  default_value?: string | null;
  not_null?: boolean;
}

export type AlterTableOperation =
  | { action: 'add_column'; column: AlterColumnDefinition }
  | { action: 'drop_column'; column_name: string }
  | { action: 'rename_column'; old_name: string; new_name: string }
  | { action: 'rename_table'; new_table_name: string };

export type AlterTablePayload = AlterTableOperation | { operations: AlterTableOperation[] };

export interface AlterTableResponse {
  message: string;
  db_name: string;
  /** Final table name after all operations. */
  table_name: string;
  statements: string[];
  /** Null if the server cannot read metadata after committing the alteration. */
  schema: SchemaColumn[] | null;
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
