export interface PostgreSQLClient {
  testConnection(): Promise<boolean>;
  createBackup(outputPath: string): Promise<BackupInfo>;
}

export interface BackupInfo {
  filePath: string;
  fileSize: number;
  databaseName: string;
  timestamp: Date;
} 