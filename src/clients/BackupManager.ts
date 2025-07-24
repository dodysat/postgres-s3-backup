import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BackupManager as IBackupManager, BackupResult } from '../interfaces/BackupManager';
import { PostgreSQLClient } from '../interfaces/PostgreSQLClient';
import { S3Client } from '../interfaces/S3Client';
import { RetentionManager } from '../interfaces/RetentionManager';
import { BackupConfig } from '../interfaces/BackupConfig';

/**
 * BackupManager implementation that orchestrates the complete backup process
 * Coordinates PostgreSQL backup creation, S3 upload, and retention cleanup
 */
export class BackupManager implements IBackupManager {
  private postgresClient: PostgreSQLClient;
  private s3Client: S3Client;
  private retentionManager: RetentionManager;
  private config: BackupConfig;

  constructor(
    postgresClient: PostgreSQLClient,
    s3Client: S3Client,
    retentionManager: RetentionManager,
    config: BackupConfig
  ) {
    this.postgresClient = postgresClient;
    this.s3Client = s3Client;
    this.retentionManager = retentionManager;
    this.config = config;
  }

  /**
   * Execute a complete backup operation
   * Creates backup, uploads to S3, cleans up retention, and handles errors
   */
  async executeBackup(): Promise<BackupResult> {
    const startTime = Date.now();
    let tempFilePath: string | null = null;
    
    try {
      console.log('Starting backup operation...');
      
      // Generate backup filename with timestamp
      const fileName = this.generateBackupFileName();
      const s3Key = this.buildS3Key(fileName);
      
      // Create temporary file path
      tempFilePath = join(tmpdir(), fileName);
      
      console.log(`Creating backup: ${fileName}`);
      
      // Step 1: Create PostgreSQL backup
      const backupInfo = await this.postgresClient.createBackup(tempFilePath);
      
      console.log(`Backup created successfully: ${backupInfo.fileSize} bytes`);
      
      // Step 2: Upload to S3
      console.log(`Uploading backup to S3: ${s3Key}`);
      const s3Location = await this.s3Client.uploadFile(tempFilePath, s3Key);
      
      console.log(`Backup uploaded successfully to: ${s3Location}`);
      
      // Step 3: Clean up retention (run in background, don't fail backup on retention errors)
      this.performRetentionCleanup().catch(error => {
        console.warn('Retention cleanup failed (backup still successful):', error.message);
      });
      
      // Step 4: Clean up temporary file
      await this.cleanupTempFile(tempFilePath);
      tempFilePath = null; // Mark as cleaned up
      
      const duration = Date.now() - startTime;
      
      console.log(`Backup operation completed successfully in ${duration}ms`);
      
      return {
        success: true,
        fileName,
        fileSize: backupInfo.fileSize,
        s3Location,
        duration
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`Backup operation failed after ${duration}ms:`, errorMessage);
      
      // Clean up temporary file if it exists
      if (tempFilePath) {
        await this.cleanupTempFile(tempFilePath).catch(cleanupError => {
          console.warn('Failed to cleanup temporary file:', cleanupError.message);
        });
      }
      
      return {
        success: false,
        fileName: '',
        fileSize: 0,
        s3Location: '',
        duration,
        error: errorMessage
      };
    }
  }

  /**
   * Validate the current configuration
   * Checks connectivity to PostgreSQL and S3
   */
  async validateConfiguration(): Promise<boolean> {
    try {
      console.log('Validating configuration...');
      
      // Test PostgreSQL connection
      console.log('Testing PostgreSQL connection...');
      const pgConnected = await this.postgresClient.testConnection();
      if (!pgConnected) {
        console.error('PostgreSQL connection test failed');
        return false;
      }
      console.log('PostgreSQL connection test passed');
      
      // Test S3 connection
      console.log('Testing S3 connection...');
      const s3Connected = await this.s3Client.testConnection();
      if (!s3Connected) {
        console.error('S3 connection test failed');
        return false;
      }
      console.log('S3 connection test passed');
      
      // Validate backup interval (cron format)
      if (!this.isValidCronExpression(this.config.backupInterval)) {
        console.error('Invalid backup interval (cron format):', this.config.backupInterval);
        return false;
      }
      console.log('Backup interval validation passed');
      
      console.log('Configuration validation completed successfully');
      return true;
      
    } catch (error) {
      console.error('Configuration validation failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Generate backup filename with timestamp format (YYYY-MM-DD_HH-MM-SS)
   */
  private generateBackupFileName(): string {
    const now = new Date();
    const timestamp = this.formatTimestamp(now);
    return `postgres-backup-${timestamp}.sql.gz`;
  }

  /**
   * Format date to YYYY-MM-DD_HH-MM-SS format
   */
  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  }

  /**
   * Build S3 key with configured path prefix
   */
  private buildS3Key(fileName: string): string {
    const s3Path = this.config.s3Path || '';
    
    // Ensure path doesn't start with / and ends with / if not empty
    const normalizedPath = s3Path
      .replace(/^\/+/, '') // Remove leading slashes
      .replace(/\/+$/, ''); // Remove trailing slashes
    
    if (normalizedPath) {
      return `${normalizedPath}/${fileName}`;
    }
    
    return fileName;
  }

  /**
   * Perform retention cleanup in the background
   */
  private async performRetentionCleanup(): Promise<void> {
    try {
      const prefix = this.config.s3Path || '';
      const result = await this.retentionManager.cleanupExpiredBackups(prefix);
      
      if (result.deletedCount > 0) {
        console.log(`Retention cleanup completed: ${result.deletedCount} expired backups deleted`);
      }
      
      if (result.errors.length > 0) {
        console.warn(`Retention cleanup had ${result.errors.length} errors:`, result.errors);
      }
    } catch (error) {
      throw new Error(`Retention cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean up temporary backup file
   */
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      console.log(`Cleaned up temporary file: ${filePath}`);
    } catch (error) {
      // Only log if file actually exists (ignore ENOENT errors)
      if ((error as any).code !== 'ENOENT') {
        throw new Error(`Failed to cleanup temporary file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Basic cron expression validation
   * Validates format: minute hour day month day-of-week
   */
  private isValidCronExpression(expression: string): boolean {
    try {
      const parts = expression.trim().split(/\s+/);
      
      // Standard cron has 5 parts: minute hour day month day-of-week
      if (parts.length !== 5) {
        return false;
      }
      
      // Basic validation for each part
      const [minute, hour, day, month, dayOfWeek] = parts;
      
      return (
        this.isValidCronField(minute, 0, 59) &&
        this.isValidCronField(hour, 0, 23) &&
        this.isValidCronField(day, 1, 31) &&
        this.isValidCronField(month, 1, 12) &&
        this.isValidCronField(dayOfWeek, 0, 7) // 0 and 7 both represent Sunday
      );
    } catch {
      return false;
    }
  }

  /**
   * Validate individual cron field
   */
  private isValidCronField(field: string, min: number, max: number): boolean {
    // Allow * (any value)
    if (field === '*') {
      return true;
    }
    
    // Allow step values (e.g., */5, 0-23/2) - handle this before ranges
    if (field.includes('/')) {
      const [range, step] = field.split('/');
      const stepNum = Number(step);
      if (isNaN(stepNum) || stepNum <= 0) {
        return false;
      }
      
      if (range === '*') {
        return true;
      }
      
      // Validate the range part recursively (without the step)
      return this.isValidCronField(range, min, max);
    }
    
    // Allow ranges (e.g., 1-5)
    if (field.includes('-')) {
      const parts = field.split('-');
      if (parts.length !== 2) {
        return false;
      }
      const [start, end] = parts.map(Number);
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end;
    }
    
    // Allow lists (e.g., 1,3,5)
    if (field.includes(',')) {
      const values = field.split(',').map(Number);
      return values.every(val => !isNaN(val) && val >= min && val <= max);
    }
    
    // Allow single numeric values
    const num = Number(field);
    return !isNaN(num) && num >= min && num <= max;
  }
}