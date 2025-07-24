export interface BackupConfig {
    s3Url?: string;
    s3Bucket: string;
    s3Path: string;
    s3AccessKey: string;
    s3SecretKey: string;
    postgresConnectionString: string;
    backupInterval: string;
    retentionDays?: number;
    logLevel?: string;
}
export interface EnvironmentConfig {
    S3_BUCKET: string;
    S3_ACCESS_KEY: string;
    S3_SECRET_KEY: string;
    POSTGRES_CONNECTION_STRING: string;
    BACKUP_INTERVAL: string;
    S3_URL?: string;
    S3_PATH?: string;
    BACKUP_RETENTION_DAYS?: string;
    LOG_LEVEL?: string;
}
//# sourceMappingURL=BackupConfig.d.ts.map