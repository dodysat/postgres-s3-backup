import {
  RetentionManager as IRetentionManager,
  RetentionResult,
} from '../interfaces/RetentionManager';
import { S3Client } from '../interfaces/S3Client';
import { BackupConfig } from '../interfaces/BackupConfig';

/**
 * Custom error classes for retention management operations
 */
export class RetentionError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RetentionError';
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class RetentionListingError extends RetentionError {
  constructor(message: string, cause?: Error) {
    super(message, 'listing', cause);
    this.name = 'RetentionListingError';
  }
}

export class RetentionDeletionError extends RetentionError {
  constructor(
    message: string,
    public readonly key: string,
    cause?: Error
  ) {
    super(message, 'deletion', cause);
    this.name = 'RetentionDeletionError';
  }
}

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
   * Clean up expired backups based on retention policy with enhanced error handling
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

      console.log(`Starting retention cleanup with ${this.retentionDays} day retention policy`);

      // List all objects with the given prefix with retry logic
      let objects;
      try {
        objects = await this.withRetry(
          () => this.s3Client.listObjects(prefix),
          'list S3 objects for retention cleanup',
          3
        );
      } catch (error) {
        const listingError = new RetentionListingError(
          `Failed to list backups for cleanup: ${this.formatError(error)}`,
          error instanceof Error ? error : undefined
        );
        result.errors.push(listingError.message);
        console.error(listingError.message);
        return result;
      }

      result.totalCount = objects.length;

      if (objects.length === 0) {
        console.log(`No backups found with prefix: ${prefix}`);
        return result;
      }

      console.log(`Found ${objects.length} backup files, checking for expired backups...`);

      // Calculate cutoff date once
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      console.log(`Deleting backups older than: ${cutoffDate.toISOString()}`);

      // Filter and delete expired backups with individual error handling
      const deletionPromises = objects.map(async obj => {
        try {
          if (this.isBackupExpired(obj.key, obj.lastModified)) {
            await this.withRetry(
              () => this.s3Client.deleteObject(obj.key),
              `delete backup ${obj.key}`,
              2 // Fewer retries for individual deletions
            );

            result.deletedCount++;
            result.deletedKeys.push(obj.key);
            console.log(
              `Deleted expired backup: ${obj.key} (created: ${obj.lastModified.toISOString()})`
            );
          } else {
            console.debug(
              `Keeping backup: ${obj.key} (created: ${obj.lastModified.toISOString()})`
            );
          }
        } catch (error) {
          const deletionError = new RetentionDeletionError(
            `Failed to delete backup ${obj.key}: ${this.formatError(error)}`,
            obj.key,
            error instanceof Error ? error : undefined
          );
          result.errors.push(deletionError.message);
          console.error(deletionError.message);

          // Log additional context for debugging
          console.error(`Deletion error context:`, {
            key: obj.key,
            lastModified: obj.lastModified.toISOString(),
            size: obj.size,
            errorType: error instanceof Error ? error.name : 'Unknown',
          });
        }
      });

      // Wait for all deletion operations to complete
      await Promise.allSettled(deletionPromises);

      const successRate =
        result.totalCount > 0
          ? (((result.totalCount - result.errors.length) / result.totalCount) * 100).toFixed(1)
          : '100';
      console.log(
        `Retention cleanup completed: ${result.deletedCount} backups deleted out of ${result.totalCount} total (${successRate}% success rate)`
      );

      if (result.errors.length > 0) {
        console.warn(
          `Retention cleanup had ${result.errors.length} errors. Some backups may not have been deleted.`
        );
      }
    } catch (error) {
      const generalError = new RetentionError(
        `Unexpected error during retention cleanup: ${this.formatError(error)}`,
        'cleanup',
        error instanceof Error ? error : undefined
      );
      result.errors.push(generalError.message);
      console.error(generalError.message);

      // Log stack trace for debugging
      if (error instanceof Error && error.stack) {
        console.error('Retention cleanup stack trace:', error.stack);
      }
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
      const timestampMatch = filename.match(
        /postgres-backup-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/
      );

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
        console.warn(
          `Failed to extract timestamp from backup key ${backupKey}: Invalid date parsed from ${isoTimestamp}`
        );
        return null;
      }

      return date;
    } catch (error) {
      console.warn(
        `Failed to extract timestamp from backup key ${backupKey}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Execute an operation with retry logic
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain error types
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        if (attempt === maxRetries) {
          throw new RetentionError(
            `Failed to ${operationName} after ${maxRetries} attempts. Last error: ${this.formatError(lastError)}`,
            operationName,
            lastError
          );
        }

        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(
          `Attempt ${attempt} failed for ${operationName}: ${this.formatError(lastError)}. Retrying in ${delay}ms...`
        );

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRetryableError(error: any): boolean {
    // Don't retry on authentication errors, permission errors, or invalid bucket names
    const nonRetryableCodes = [
      'InvalidAccessKeyId',
      'SignatureDoesNotMatch',
      'AccessDenied',
      'NoSuchBucket',
      'InvalidBucketName',
      'BucketNotEmpty',
    ];

    return (
      nonRetryableCodes.includes(error.name) ||
      nonRetryableCodes.includes(error.Code) ||
      (error.$metadata?.httpStatusCode >= 400 && error.$metadata?.httpStatusCode < 500)
    );
  }

  /**
   * Format error for consistent logging
   */
  private formatError(error: any): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
