import { RetentionManager as IRetentionManager, RetentionResult } from '../interfaces/RetentionManager';
import { S3Client } from '../interfaces/S3Client';
import { BackupConfig } from '../interfaces/BackupConfig';

/**
 * RetentionManager implementation for managing backup lifecycle
 * Handles identification and deletion of expired backups based on retention policy
 */
export class RetentionManager implements IRetentionManager {
  private s3Client: S3Client;
  private retentionDays: number | undefined;

  constructor(s3Client: S3Client, config: BackupConfig) {
    this.s3Client = s3Client;
    this.retentionDays = config.retentionDays;
  }

  /**
   * Clean up expired backups based on retention policy
   * If retentionDays is not configured, no backups will be deleted
   */
  async cleanupExpiredBackups(prefix: string): Promise<RetentionResult> {
    const result: RetentionResult = {
      deletedCount: 0,
      totalCount: 0,
      deletedKeys: [],
      errors: [],
    };

    try {
      // If no retention policy is set, keep all backups
      if (this.retentionDays === undefined) {
        console.log('No retention policy configured, keeping all backups');
        return result;
      }

      // List all objects with the given prefix
      const objects = await this.s3Client.listObjects(prefix);
      result.totalCount = objects.length;

      if (objects.length === 0) {
        console.log(`No backups found with prefix: ${prefix}`);
        return result;
      }

      console.log(`Found ${objects.length} backup files, checking for expired backups...`);

      // Filter and delete expired backups
      for (const obj of objects) {
        try {
          if (this.isBackupExpired(obj.key, obj.lastModified)) {
            await this.s3Client.deleteObject(obj.key);
            result.deletedCount++;
            result.deletedKeys.push(obj.key);
            console.log(`Deleted expired backup: ${obj.key}`);
          }
        } catch (error) {
          const errorMsg = `Failed to delete backup ${obj.key}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      console.log(`Retention cleanup completed: ${result.deletedCount} backups deleted out of ${result.totalCount} total`);
      
    } catch (error) {
      const errorMsg = `Failed to list backups for cleanup: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
    }

    return result;
  }

  /**
   * Check if a backup file is expired based on retention policy
   * Uses the backup filename timestamp if available, otherwise falls back to lastModified
   */
  isBackupExpired(backupKey: string, lastModified: Date): boolean {
    if (this.retentionDays === undefined) {
      return false; // No retention policy means keep all backups
    }

    // Special case: 0 retention days means delete all backups immediately
    if (this.retentionDays === 0) {
      return true;
    }

    // First try to extract timestamp from filename for more accurate dating
    const filenameTimestamp = this.extractTimestampFromKey(backupKey);
    const backupDate = filenameTimestamp || lastModified;

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    return backupDate < cutoffDate;
  }

  /**
   * Extract timestamp from backup filename
   * Expected format: postgres-backup-YYYY-MM-DD_HH-MM-SS.sql.gz
   */
  extractTimestampFromKey(backupKey: string): Date | null {
    try {
      // Extract filename from full S3 key (remove path prefix)
      const filename = backupKey.split('/').pop() || backupKey;
      
      // Match the expected backup filename pattern
      const timestampMatch = filename.match(/postgres-backup-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
      
      if (!timestampMatch) {
        return null;
      }

      const timestampStr = timestampMatch[1];
      
      // Convert YYYY-MM-DD_HH-MM-SS to YYYY-MM-DDTHH:MM:SS format
      const isoTimestamp = timestampStr.replace('_', 'T').replace(/-/g, (match, offset) => {
        // Replace hyphens in time part with colons, keep date hyphens
        return offset > 10 ? ':' : match;
      });

      const date = new Date(isoTimestamp);
      
      // Validate the parsed date
      if (isNaN(date.getTime())) {
        console.warn(`Failed to extract timestamp from backup key ${backupKey}: Invalid date parsed from ${isoTimestamp}`);
        return null;
      }

      return date;
    } catch (error) {
      console.warn(`Failed to extract timestamp from backup key ${backupKey}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}