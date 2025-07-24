export interface BackupResult {
    success: boolean;
    fileName: string;
    fileSize: number;
    s3Location: string;
    duration: number;
    error?: string;
}
export interface BackupMetadata {
    fileName: string;
    timestamp: Date;
    databaseName: string;
    fileSize: number;
    s3Key: string;
    compressionRatio: number;
}
export interface BackupManager {
    executeBackup(): Promise<BackupResult>;
    validateConfiguration(): boolean;
}
//# sourceMappingURL=BackupManager.d.ts.map