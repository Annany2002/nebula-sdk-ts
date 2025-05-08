// src/types/schema.ts

/** Definition of a single column in a table schema */
export interface ColumnDefinition {
  name: string;
  /** Data type for the column (e.g., TEXT, INTEGER, REAL, BLOB, BOOLEAN, etc.) */
  type: string;
  // Add other constraints later if supported (e.g., primaryKey, unique, notNull, defaultValue)
  // primaryKey?: boolean;
  // unique?: boolean;
  // notNull?: boolean;
  // defaultValue?: string | number | boolean;
}

/** Payload for defining a table schema */
export interface SchemaPayload {
  table_name: string;
  columns: ColumnDefinition[];
}

/** Assumed response structure after defining a schema */
export interface SchemaInfoResponse {
  table_name: string;
  columns: ColumnDefinition[];
  message?: string; // Example field
}

export interface TableListResponseType {
  type: string;
  name: string;
  tbl_name: string;
  rootpage: string;
  sql: string;
  createdAt: string;
  columns: ColumnDefinition[];
}
/** Assumed response structure for listing tables in a database */
export interface TableListResponse {
  tables: TableListResponseType[];
}
