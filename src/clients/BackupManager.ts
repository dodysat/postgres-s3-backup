import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BackupManager as IBackupManager, BackupResult } from '../interfaces/BackupManager';
import { PostgreSQLClient } from '../interfaces/PostgreSQLClient';
import { S3Client } from '../interfaces/S3Client';
import { RetentionManager } from '../interfaces/RetentionManager';
import { BackupConfig } from '../interfaces/BackupConfig';

/**
 * Custom error classes for better error handling and categorization
 */
export class BackupError extends Error {
  constructor(message: string, public readonly operation: string, public readonly cause?: Error) {
    super(message);
    this.name = 'BackupError';
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class RetryableError extends Error {
  constructor(message: string, public readonly operation: string, public readonly attempt: number, public readonly maxAttempts: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

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
   * Execute a complete backup operation with comprehensive error handling
   * Creates backup, uploads to S3, cleans up retention, and handles errors
   */
  async executeBackup(): Promise<BackupResult> {
    const startTime = Date.now();
    let tempFilePath: string | null = null;
    const operationId = this.generateOperationId();
    
    try {
      console.log(`[${operationId}] Starting backup operation...`);
      
      // Generate backup filename with timestamp
      const fileName = this.generateBackupFileName();
      const s3Key = this.buildS3Key(fileName);
      
      // Create temporary file path
      tempFilePath = join(tmpdir(), fileName);
      
      console.log(`[${operationId}] Creating backup: ${fileName}`);
      
      // Step 1: Create PostgreSQL backup with retry logic
      const backupInfo = await this.withRetry(
        () => this.postgresClient.createBackup(tempFilePath!),
        'PostgreSQL backup creation',
        operationId,
        2, // Max 2 retries for database operations
        [5000, 10000] // 5s, 10s delays
      );
      
      console.log(`[${operationId}] Backup created successfully: ${backupInfo.fileSize} bytes`);
      
      // Step 2: Upload to S3 with retry logic (S3Client already has its own retry logic)
      console.log(`[${operationId}] Uploading backup to S3: ${s3Key}`);
      const s3Location = await this.s3Client.uploadFile(tempFilePath, s3Key);
      
      console.log(`[${operationId}] Backup uploaded successfully to: ${s3Location}`);
      
      // Step 3: Clean up retention (run in background, don't fail backup on retention errors)
      this.performRetentionCleanup(operationId).catch(error => {
        console.warn(`[${operationId}] Retention cleanup failed (backup still successful):`, this.formatError(error));
      });
      
      // Step 4: Clean up temporary file
      await this.cleanupTempFile(tempFilePath, operationId);
      tempFilePath = null; // Mark as cleaned up
      
      const duration = Date.now() - startTime;
      
      console.log(`[${operationId}] Backup operation completed successfully in ${duration}ms`);
      
      return {
        success: true,
        fileName,
        fileSize: backupInfo.fileSize,
        s3Location,
        duration
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const formattedError = this.formatError(error);
      
      console.error(`[${operationId}] Backup operation failed after ${duration}ms:`, formattedError);
      
      // Log stack trace for debugging
      if (error instanceof Error && error.stack) {
        console.error(`[${operationId}] Stack trace:`, error.stack);
      }
      
      // Clean up temporary file if it exists
      if (tempFilePath) {
        await this.cleanupTempFile(tempFilePath, operationId).catch(cleanupError => {
          console.warn(`[${operationId}] Failed to cleanup temporary file:`, this.formatError(cleanupError));
        });
      }
      
      return {
        success: false,
        fileName: '',
        fileSize: 0,
        s3Location: '',
        duration,
        error: formattedError
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
   * Perform retention cleanup in the background with operation tracking
   */
  private async performRetentionCleanup(operationId: string): Promise<void> {
    try {
      const prefix = this.config.s3Path || '';
      const result = await this.retentionManager.cleanupExpiredBackups(prefix);
      
      if (result.deletedCount > 0) {
        console.log(`[${operationId}] Retention cleanup completed: ${result.deletedCount} expired backups deleted`);
      }
      
      if (result.errors.length > 0) {
        console.warn(`[${operationId}] Retention cleanup had ${result.errors.length} errors:`, result.errors);
      }
    } catch (error) {
      throw new BackupError(`Retention cleanup failed: ${this.formatError(error)}`, 'retention_cleanup', error instanceof Error ? error : undefined);
    }
  }

  /**
   * Clean up temporary backup file with operation tracking
   */
  private async cleanupTempFile(filePath: string, operationId: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      console.log(`[${operationId}] Cleaned up temporary file: ${filePath}`);
    } catch (error) {
      // Only log if file actually exists (ignore ENOENT errors)
      if ((error as any).code !== 'ENOENT') {
        throw new BackupError(`Failed to cleanup temporary file ${filePath}: ${this.formatError(error)}`, 'temp_file_cleanup', error instanceof Error ? error : undefined);
      }
    }
  }

  /**
   * Execute an operation with retry logic and exponential backoff
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    operationId: string,
    maxRetries: number = 3,
    delays: number[] = [1000, 2000, 4000]
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on certain error types
        if (this.isNonRetryableError(error)) {
          console.error(`[${operationId}] Non-retryable error in ${operationName}:`, this.formatError(error));
          throw error;
        }

        if (attempt === maxRetries) {
          const finalError = new RetryableError(
            `Failed to ${operationName} after ${maxRetries} attempts. Last error: ${this.formatError(lastError)}`,
            operationName,
            attempt,
            maxRetries
          );
          console.error(`[${operationId}] ${finalError.message}`);
          throw finalError;
        }

        // Calculate delay for this attempt
        const delay = delays[attempt - 1] || delays[delays.length - 1];
        console.warn(
          `[${operationId}] Attempt ${attempt} failed for ${operationName}: ${this.formatError(lastError)}. Retrying in ${delay}ms...`
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
    // Don't retry on validation errors, configuration errors, or permission errors
    if (error instanceof ValidationError) {
      return true;
    }

    // Don't retry on specific PostgreSQL errors
    if (error.message?.includes('authentication failed') ||
        error.message?.includes('database does not exist') ||
        error.message?.includes('permission denied')) {
      return true;
    }

    // Don't retry on file system permission errors
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return true;
    }

    return false;
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
   * Generate unique operation ID for tracking
   */
  private generateOperationId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `backup-${timestamp}-${random}`;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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