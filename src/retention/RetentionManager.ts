import { S3Client } from '../s3/S3Client';
import { BackupConfig } from '../interfaces/BackupConfig';
import { S3Object } from '../interfaces/S3Client';

export class RetentionManager {
  private s3Client: S3Client;
  private config: BackupConfig;

  constructor(s3Client: S3Client, config: BackupConfig) {
    this.s3Client = s3Client;
    this.config = config;
  }

  public async cleanupExpiredBackups(): Promise<number> {
    if (!this.config.retentionDays) {
      console.log('No retention period configured, skipping cleanup');
      return 0;
    }

    try {
      console.log(
        `Starting cleanup of backups older than ${this.config.retentionDays} days`
      );

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      console.log(`Cutoff date for deletion: ${cutoffDate.toISOString()}`);

      // List all backup objects in the configured path
      const objects = await this.s3Client.listObjects(this.config.s3Path);

      if (objects.length === 0) {
        console.log('No backup objects found to check for cleanup');
        return 0;
      }

      // Filter objects that match backup naming pattern and are older than retention period
      const expiredObjects = this.filterExpiredBackups(objects, cutoffDate);

      if (expiredObjects.length === 0) {
        console.log('No expired backups found for cleanup');
        return 0;
      }

      console.log(`Found ${expiredObjects.length} expired backups to delete`);

      // Delete expired backups
      let deletedCount = 0;
      for (const object of expiredObjects) {
        try {
          await this.s3Client.deleteObject(object.key);
          deletedCount++;
          console.log(`Deleted expired backup: ${object.key}`);
        } catch (error) {
          console.error(
            `Failed to delete expired backup ${object.key}:`,
            error
          );
          // Continue with other deletions even if one fails
        }
      }

      console.log(
        `Cleanup completed: ${deletedCount}/${expiredObjects.length} expired backups deleted`
      );
      return deletedCount;
    } catch (error) {
      console.error('Failed to cleanup expired backups:', error);
      throw new Error(
        `Retention cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private filterExpiredBackups(
    objects: S3Object[],
    cutoffDate: Date
  ): S3Object[] {
    const backupPattern =
      /^.*\/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/;

    return objects.filter((object) => {
      // Check if object matches backup naming pattern
      if (!backupPattern.test(object.key)) {
        return false;
      }

      // Check if object is older than cutoff date
      return object.lastModified < cutoffDate;
    });
  }

  public async getBackupStats(): Promise<{
    totalBackups: number;
    expiredBackups: number;
    totalSize: number;
    expiredSize: number;
  }> {
    try {
      const objects = await this.s3Client.listObjects(this.config.s3Path);

      if (objects.length === 0) {
        return {
          totalBackups: 0,
          expiredBackups: 0,
          totalSize: 0,
          expiredSize: 0,
        };
      }

      const backupPattern =
        /^.*\/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/;
      const backupObjects = objects.filter((obj) =>
        backupPattern.test(obj.key)
      );

      let totalSize = 0;
      let expiredSize = 0;
      let expiredCount = 0;

      if (this.config.retentionDays) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

        for (const obj of backupObjects) {
          totalSize += obj.size;
          if (obj.lastModified < cutoffDate) {
            expiredCount++;
            expiredSize += obj.size;
          }
        }
      } else {
        // No retention configured, all backups are considered current
        totalSize = backupObjects.reduce((sum, obj) => sum + obj.size, 0);
      }

      return {
        totalBackups: backupObjects.length,
        expiredBackups: expiredCount,
        totalSize,
        expiredSize,
      };
    } catch (error) {
      console.error('Failed to get backup stats:', error);
      throw new Error(
        `Failed to get backup stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  public async listExpiredBackups(): Promise<S3Object[]> {
    if (!this.config.retentionDays) {
      return [];
    }

    try {
      const objects = await this.s3Client.listObjects(this.config.s3Path);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      return this.filterExpiredBackups(objects, cutoffDate);
    } catch (error) {
      console.error('Failed to list expired backups:', error);
      throw new Error(
        `Failed to list expired backups: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  public async validateRetentionConfiguration(): Promise<boolean> {
    try {
      // Test S3 connection
      const s3Connected = await this.s3Client.testConnection();
      if (!s3Connected) {
        console.error('Retention validation failed: Cannot connect to S3');
        return false;
      }

      // Test listing objects
      await this.s3Client.listObjects(this.config.s3Path);

      console.log('Retention configuration validation successful');
      return true;
    } catch (error) {
      console.error('Retention configuration validation failed:', error);
      return false;
    }
  }
}
