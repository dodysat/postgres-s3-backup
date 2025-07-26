export interface BackupConfig {
  s3Url?: string;
  s3Bucket: string;
  s3Path: string;
  s3AccessKey: string;
  s3SecretKey: string;
  postgresConnectionString: string;
  backupInterval: string; // cron format
  retentionDays?: number;
  logLevel?: string;
} 