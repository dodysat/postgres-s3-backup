export interface BackupMetadata {
  fileName: string;
  timestamp: Date;
  databaseName: string;
  fileSize: number;
  s3Key: string;
  compressionRatio: number;
} 