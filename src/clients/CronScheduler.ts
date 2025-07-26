import * as cron from 'node-cron';
import { CronScheduler as ICronScheduler, CronSchedulerConfig } from '../interfaces/CronScheduler';
import { BackupManager } from '../interfaces/BackupManager';

/**
 * Custom error classes for cron scheduling operations
 */
export class CronSchedulerError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'CronSchedulerError';
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class CronValidationError extends CronSchedulerError {
  constructor(
    message: string,
    public readonly expression: string
  ) {
    super(message, 'validation');
    this.name = 'CronValidationError';
  }
}

export class CronExecutionError extends CronSchedulerError {
  constructor(message: string, cause?: Error) {
    super(message, 'execution', cause);
    this.name = 'CronExecutionError';
  }
}

/**
 * CronScheduler implementation using node-cron library
 * Handles scheduled backup execution with proper error handling and overlap prevention
 */
export class CronScheduler implements ICronScheduler {
  private task: cron.ScheduledTask | null = null;
  private config: CronSchedulerConfig;
  private backupManager: BackupManager;
  private isBackupRunning = false;
  private logger: Console;

  constructor(
    config: CronSchedulerConfig,
    backupManager: BackupManager,
    logger: Console = console
  ) {
    this.config = config;
    this.backupManager = backupManager;
    this.logger = logger;
  }

  /**
   * Start the cron scheduler with enhanced error handling
   */
  start(): void {
    if (this.task) {
      this.logger.warn('CronScheduler is already running');
      return;
    }

    try {
      // Validate cron expression before starting
      if (!this.validateCronExpression(this.config.cronExpression)) {
        throw new CronValidationError(
          `Invalid cron expression: ${this.config.cronExpression}`,
          this.config.cronExpression
        );
      }

      this.logger.log(
        `Starting cron scheduler with expression: ${this.config.cronExpression} (timezone: ${this.config.timezone || 'UTC'})`
      );

      // Create the scheduled task with error handling wrapper
      this.task = cron.schedule(
        this.config.cronExpression,
        async () => {
          try {
            await this.executeScheduledBackup();
          } catch (error) {
            // This should not happen as executeScheduledBackup handles its own errors,
            // but we add this as a safety net
            const cronError = new CronExecutionError(
              `Unexpected error in scheduled backup execution: ${this.formatError(error)}`,
              error instanceof Error ? error : undefined
            );
            this.logger.error(cronError.message);

            if (error instanceof Error && error.stack) {
              this.logger.error('Unexpected error stack trace:', error.stack);
            }
          }
        },
        {
          scheduled: false, // Don't start immediately
          timezone: this.config.timezone || 'UTC',
        }
      );

      // Start the task
      this.task.start();

      this.logger.log('CronScheduler started successfully');

      // Run immediately if configured to do so
      if (this.config.runOnInit) {
        this.logger.log('Running initial backup due to runOnInit configuration');
        setImmediate(() => {
          this.executeScheduledBackup().catch(error => {
            this.logger.error('Initial backup execution failed:', this.formatError(error));
          });
        });
      }
    } catch (error) {
      if (error instanceof CronValidationError) {
        throw error;
      }

      const startError = new CronSchedulerError(
        `Failed to start cron scheduler: ${this.formatError(error)}`,
        'start',
        error instanceof Error ? error : undefined
      );
      this.logger.error(startError.message);
      throw startError;
    }
  }

  /**
   * Stop the cron scheduler
   */
  stop(): void {
    if (!this.task) {
      this.logger.warn('CronScheduler is not running');
      return;
    }

    this.logger.log('Stopping cron scheduler...');
    this.task.stop();
    this.task = null;
    this.logger.log('CronScheduler stopped successfully');
  }

  /**
   * Check if the scheduler is currently running
   */
  isRunning(): boolean {
    return this.task !== null;
  }

  /**
   * Validate a cron expression using node-cron's built-in validation
   */
  validateCronExpression(expression: string): boolean {
    try {
      return cron.validate(expression);
    } catch (error) {
      this.logger.error(
        'Cron expression validation error:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return false;
    }
  }

  /**
   * Get the next scheduled execution time
   * Note: node-cron doesn't provide a direct way to get next execution time
   */
  getNextScheduledTime(): Date | null {
    if (!this.validateCronExpression(this.config.cronExpression)) {
      return null;
    }

    // Unfortunately, node-cron doesn't expose next execution time directly
    this.logger.warn('getNextScheduledTime: node-cron does not expose next execution time');
    return null;
  }

  /**
   * Execute a scheduled backup with overlap prevention and enhanced error handling
   */
  private async executeScheduledBackup(): Promise<void> {
    // Prevent overlapping backups
    if (this.isBackupRunning) {
      this.logger.warn('Backup is already running, skipping this scheduled execution');
      return;
    }

    this.isBackupRunning = true;
    const startTime = new Date();
    const executionId = this.generateExecutionId();

    try {
      this.logger.log(`[${executionId}] Starting scheduled backup at ${startTime.toISOString()}`);

      // Execute the backup with timeout protection
      const result = await Promise.race([
        this.backupManager.executeBackup(),
        this.createTimeoutPromise(60 * 60 * 1000), // 1 hour timeout
      ]);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      if (result.success) {
        this.logger.log(
          `[${executionId}] Scheduled backup completed successfully in ${duration}ms. ` +
            `File: ${result.fileName}, Size: ${result.fileSize} bytes, Location: ${result.s3Location}`
        );
      } else {
        this.logger.error(
          `[${executionId}] Scheduled backup failed after ${duration}ms. Error: ${result.error}`
        );
      }
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.error(
        `[${executionId}] Scheduled backup execution failed after ${duration}ms: ${this.formatError(error)}`
      );

      // Log stack trace for debugging
      if (error instanceof Error && error.stack) {
        this.logger.error(`[${executionId}] Stack trace:`, error.stack);
      }

      // Log additional context for debugging
      this.logger.error(`[${executionId}] Execution context:`, {
        startTime: startTime.toISOString(),
        duration,
        cronExpression: this.config.cronExpression,
        timezone: this.config.timezone || 'UTC',
      });
    } finally {
      this.isBackupRunning = false;
      this.logger.log(`[${executionId}] Backup execution completed, ready for next scheduled run`);
    }
  }

  /**
   * Create a timeout promise for backup execution
   */
  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new CronExecutionError(`Backup execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Generate unique execution ID for tracking
   */
  private generateExecutionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 6);
    return `cron-${timestamp}-${random}`;
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
}
