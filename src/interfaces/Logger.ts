export interface Logger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, error?: Error, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;

  // Specialized logging methods for backup operations
  logBackupStart(databaseName: string, meta?: Record<string, any>): void;
  logBackupComplete(fileName: string, fileSize: number, s3Location: string, duration: number): void;
  logBackupError(operation: string, error: Error, meta?: Record<string, any>): void;
  logRetentionCleanup(deletedCount: number, retentionDays: number): void;
  logConfigurationStart(config: Record<string, any>): void;
  logScheduledExecution(cronExpression: string): void;
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}
