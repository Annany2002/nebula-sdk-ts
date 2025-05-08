// src/types/database.ts

/** Type for a DbListResponse */
export type DbListRType = {
  databaseId: number;
  userId: string;
  dbName: string;
  filePath: string;
  createdAt: string;
  tables: number;
  apiKey: string;
};

/** Response structure for listing databases */
export interface DbListResponse {
  databases: DbListRType[];
}
