export interface BackupManager {
  executeBackup(): Promise<BackupResult>;
  validateConfiguration(): boolean;
}

export interface BackupResult {
  success: boolean;
  fileName: string;
  fileSize: number;
  s3Location: string;
  duration: number;
  error?: string;
} 