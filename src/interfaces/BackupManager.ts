/**
 * Result of a backup operation
 */
export interface BackupResult {
  /** Whether the backup operation was successful */
  success: boolean;

  /** Name of the backup file created */
  fileName: string;

  /** Size of the backup file in bytes */
  fileSize: number;

  /** S3 location where the backup was stored */
  s3Location: string;

  /** Duration of the backup operation in milliseconds */
  duration: number;

  /** Error message if the backup failed */
  error?: string;
}

/**
 * Metadata about a backup file
 */
export interface BackupMetadata {
  /** Name of the backup file */
  fileName: string;

  /** Timestamp when the backup was created */
  timestamp: Date;

  /** Name of the database that was backed up */
  databaseName: string;

  /** Size of the backup file in bytes */
  fileSize: number;

  /** S3 key where the backup is stored */
  s3Key: string;

  /** Compression ratio achieved */
  compressionRatio: number;
}

/**
 * Interface for the main backup orchestration manager
 */
export interface BackupManager {
  /** Execute a complete backup operation */
  executeBackup(): Promise<BackupResult>;

  /** Validate the current configuration */
  validateConfiguration(): Promise<boolean>;
}
