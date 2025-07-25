import winston from 'winston';
import { Logger as ILogger, LogLevel } from '../interfaces/Logger';

export class Logger implements ILogger {
  private winston: winston.Logger;

  constructor(logLevel: LogLevel = LogLevel.INFO) {
    this.winston = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf((info) => {
          const { timestamp, level, message, stack, ...meta } = info;
          const logEntry: any = {
            timestamp,
            level,
            message
          };
          
          if (stack) {
            logEntry.stack = stack;
          }
          
          if (Object.keys(meta).length > 0) {
            logEntry.meta = this.sanitizeMeta(meta);
          }
          
          return JSON.stringify(logEntry);
        })
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }

  /**
   * Sanitize metadata to remove sensitive information
   */
  private sanitizeMeta(meta: Record<string, any>): Record<string, any> {
    const sensitiveKeys = [
      'password', 'secret', 'key', 'token', 'credential',
      's3accesskey', 's3secretkey', 'postgresconnectionstring',
      's3_access_key', 's3_secret_key', 'postgres_connection_string'
    ];

    const sanitized = { ...meta };
    
    for (const [key, value] of Object.entries(sanitized)) {
      const lowerKey = key.toLowerCase();
      // Check if the key contains any sensitive terms or matches exactly
      const isSensitive = sensitiveKeys.some(sensitive => 
        lowerKey.includes(sensitive) || lowerKey === sensitive
      );
      
      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMeta(value);
      }
    }

    return sanitized;
  }

  info(message: string, meta?: Record<string, any>): void {
    this.winston.info(message, meta);
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.winston.warn(message, meta);
  }

  error(message: string, error?: Error, meta?: Record<string, any>): void {
    const errorMeta = {
      ...meta,
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          // Add additional error properties if available
          ...(error as any).code && { code: (error as any).code },
          ...(error as any).errno && { errno: (error as any).errno },
          ...(error as any).syscall && { syscall: (error as any).syscall },
          ...(error as any).path && { path: (error as any).path }
        }
      })
    };
    this.winston.error(message, errorMeta);
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.winston.debug(message, meta);
  }

  logBackupStart(databaseName: string, meta?: Record<string, any>): void {
    this.info('Backup operation started', {
      operation: 'backup_start',
      databaseName,
      ...meta
    });
  }

  logBackupComplete(fileName: string, fileSize: number, s3Location: string, duration: number): void {
    this.info('Backup operation completed successfully', {
      operation: 'backup_complete',
      fileName,
      fileSize,
      s3Location,
      duration,
      fileSizeMB: Math.round(fileSize / 1024 / 1024 * 100) / 100
    });
  }

  logBackupError(operation: string, error: Error, meta?: Record<string, any>): void {
    this.error(`Backup operation failed: ${operation}`, error, {
      operation: 'backup_error',
      failedOperation: operation,
      ...meta
    });
  }

  logRetentionCleanup(deletedCount: number, retentionDays: number): void {
    this.info('Retention cleanup completed', {
      operation: 'retention_cleanup',
      deletedCount,
      retentionDays
    });
  }

  logConfigurationStart(config: Record<string, any>): void {
    this.info('Application starting with configuration', {
      operation: 'startup',
      config: this.sanitizeMeta(config)
    });
  }

  logScheduledExecution(cronExpression: string): void {
    this.info('Scheduled backup execution triggered', {
      operation: 'scheduled_execution',
      cronExpression
    });
  }

  /**
   * Create a logger instance with the specified log level from environment
   */
  static createFromEnvironment(): Logger {
    const logLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || LogLevel.INFO;
    
    // Validate log level
    if (!Object.values(LogLevel).includes(logLevel)) {
      console.warn(`Invalid LOG_LEVEL: ${process.env.LOG_LEVEL}. Using INFO level.`);
      return new Logger(LogLevel.INFO);
    }

    return new Logger(logLevel);
  }
}