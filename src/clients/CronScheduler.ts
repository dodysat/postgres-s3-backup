import * as cron from 'node-cron';
import { CronScheduler as ICronScheduler, CronSchedulerConfig } from '../interfaces/CronScheduler';
import { BackupManager } from '../interfaces/BackupManager';

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
   * Start the cron scheduler with the configured interval
   */
  start(): void {
    if (this.task) {
      this.logger.warn('CronScheduler is already running');
      return;
    }

    // Validate cron expression before starting
    if (!this.validateCronExpression(this.config.cronExpression)) {
      throw new Error(`Invalid cron expression: ${this.config.cronExpression}`);
    }

    this.logger.log(`Starting cron scheduler with expression: ${this.config.cronExpression}`);

    // Create the scheduled task
    this.task = cron.schedule(
      this.config.cronExpression,
      async () => {
        await this.executeScheduledBackup();
      },
      {
        scheduled: false, // Don't start immediately
        timezone: this.config.timezone || 'UTC'
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
          this.logger.error('Initial backup execution failed:', error.message);
        });
      });
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
      this.logger.error('Cron expression validation error:', error instanceof Error ? error.message : 'Unknown error');
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
   * Execute a scheduled backup with overlap prevention and error handling
   */
  private async executeScheduledBackup(): Promise<void> {
    // Prevent overlapping backups
    if (this.isBackupRunning) {
      this.logger.warn('Backup is already running, skipping this scheduled execution');
      return;
    }

    this.isBackupRunning = true;
    const startTime = new Date();

    try {
      this.logger.log(`Starting scheduled backup at ${startTime.toISOString()}`);

      // Execute the backup
      const result = await this.backupManager.executeBackup();

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      if (result.success) {
        this.logger.log(
          `Scheduled backup completed successfully in ${duration}ms. ` +
          `File: ${result.fileName}, Size: ${result.fileSize} bytes, Location: ${result.s3Location}`
        );
      } else {
        this.logger.error(
          `Scheduled backup failed after ${duration}ms. Error: ${result.error}`
        );
      }
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error(
        `Scheduled backup execution failed after ${duration}ms: ${errorMessage}`
      );
      
      // Log stack trace for debugging
      if (error instanceof Error && error.stack) {
        this.logger.error('Stack trace:', error.stack);
      }
    } finally {
      this.isBackupRunning = false;
      this.logger.log('Backup execution completed, ready for next scheduled run');
    }
  }
}