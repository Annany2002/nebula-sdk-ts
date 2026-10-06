import { ForeignKeyAction, TableColumnInfo } from './schema';

/** One column pair from SQLite PRAGMA foreign_key_list. */
export interface ForeignKeyInfo {
  /** Constraint ID within the source table, not a globally unique identifier. */
  id: number;
  /** Column-pair sequence within the constraint; composite keys share an id. */
  seq: number;
  /** Referenced table. */
  table: string;
  /** Source column. */
  from: string;
  /** Referenced column. */
  to: string;
  onUpdate: ForeignKeyAction;
  onDelete: ForeignKeyAction;
}

export interface TableDiagramInfo {
  name: string;
  columns: TableColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  rowCount: number;
  /** Original CREATE TABLE statement. */
  sql: string;
}

/** Raw schema inspection response; no image or canvas layout is included. */
export interface SchemaDiagram {
  tables: TableDiagramInfo[];
  totalTables: number;
  /** Number of reported foreign-key column pairs, including composite-key entries. */
  totalForeignKeys: number;
}
