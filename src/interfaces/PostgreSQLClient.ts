/**
 * Information about a created backup
 */
export interface BackupInfo {
  /** Path to the backup file */
  filePath: string;
  
  /** Size of the backup file in bytes */
  fileSize: number;
  
  /** Name of the database that was backed up */
  databaseName: string;
  
  /** Timestamp when the backup was created */
  timestamp: Date;
}

/**
 * Interface for PostgreSQL database operations
 */
export interface PostgreSQLClient {
  /** Test connection to the PostgreSQL database */
  testConnection(): Promise<boolean>;
  
  /** Create a compressed backup of the database */
  createBackup(outputPath: string): Promise<BackupInfo>;
  
  /** Get database name from connection string */
  getDatabaseName(): string;
}