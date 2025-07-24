/**
 * Interface for cron-based backup scheduling
 */
export interface CronScheduler {
  /** Start the cron scheduler with the configured interval */
  start(): void;
  
  /** Stop the cron scheduler */
  stop(): void;
  
  /** Check if the scheduler is currently running */
  isRunning(): boolean;
  
  /** Validate a cron expression */
  validateCronExpression(expression: string): boolean;
  
  /** Get the next scheduled execution time */
  getNextScheduledTime(): Date | null;
}

/**
 * Configuration for the cron scheduler
 */
export interface CronSchedulerConfig {
  /** Cron expression for backup schedule */
  cronExpression: string;
  
  /** Timezone for cron execution (defaults to UTC) */
  timezone?: string;
  
  /** Whether to run immediately on start */
  runOnInit?: boolean;
}