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