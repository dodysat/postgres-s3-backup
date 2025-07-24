/**
 * Configuration interface for the backup application
 * Maps to environment variables for containerized deployment
 */
export interface BackupConfig {
  /** S3 endpoint URL (optional, defaults to AWS S3) */
  s3Url?: string;
  
  /** S3 bucket name for storing backups */
  s3Bucket: string;
  
  /** S3 path prefix for organizing backup files */
  s3Path: string;
  
  /** S3 access key for authentication */
  s3AccessKey: string;
  
  /** S3 secret key for authentication */
  s3SecretKey: string;
  
  /** PostgreSQL connection string */
  postgresConnectionString: string;
  
  /** Backup schedule in cron format */
  backupInterval: string;
  
  /** Number of days to retain backups (optional) */
  retentionDays?: number;
  
  /** Log level for application logging */
  logLevel?: string;
}

/**
 * Raw environment configuration schema
 */
export interface EnvironmentConfig {
  // Required
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  POSTGRES_CONNECTION_STRING: string;
  BACKUP_INTERVAL: string;
  
  // Optional
  S3_URL?: string;
  S3_PATH?: string;
  BACKUP_RETENTION_DAYS?: string;
  LOG_LEVEL?: string;
}