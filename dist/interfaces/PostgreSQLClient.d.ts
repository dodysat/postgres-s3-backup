export interface BackupInfo {
    filePath: string;
    fileSize: number;
    databaseName: string;
    timestamp: Date;
}
export interface PostgreSQLClient {
    testConnection(): Promise<boolean>;
    createBackup(outputPath: string): Promise<BackupInfo>;
    getDatabaseName(): string;
}
//# sourceMappingURL=PostgreSQLClient.d.ts.map