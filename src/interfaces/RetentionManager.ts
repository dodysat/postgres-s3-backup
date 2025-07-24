/**
 * Result of a retention cleanup operation
 */
export interface RetentionResult {
  /** Number of backups that were deleted */
  deletedCount: number;
  
  /** Total number of backups found */
  totalCount: number;
  
  /** List of deleted backup keys */
  deletedKeys: string[];
  
  /** Any errors encountered during deletion */
  errors: string[];
}

/**
 * Interface for managing backup retention and cleanup
 */
export interface RetentionManager {
  /** 
   * Clean up expired backups based on retention policy
   * @param prefix S3 prefix to search for backups
   * @returns Promise resolving to cleanup results
   */
  cleanupExpiredBackups(prefix: string): Promise<RetentionResult>;
  
  /**
   * Check if a backup file is expired based on retention policy
   * @param backupKey S3 key of the backup file
   * @param lastModified Last modified date of the backup
   * @returns true if the backup should be deleted
   */
  isBackupExpired(backupKey: string, lastModified: Date): boolean;
  
  /**
   * Extract timestamp from backup filename
   * @param backupKey S3 key of the backup file
   * @returns Date object if timestamp can be parsed, null otherwise
   */
  extractTimestampFromKey(backupKey: string): Date | null;
}