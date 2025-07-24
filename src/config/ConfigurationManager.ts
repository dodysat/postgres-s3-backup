import { BackupConfig, EnvironmentConfig } from '../interfaces/BackupConfig';

/**
 * Configuration validation error with specific details
 */
export class ConfigurationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Manages application configuration from environment variables
 * Validates required fields and provides sanitized logging output
 */
export class ConfigurationManager {
  private static readonly REQUIRED_FIELDS = [
    'S3_BUCKET',
    'S3_ACCESS_KEY', 
    'S3_SECRET_KEY',
    'POSTGRES_CONNECTION_STRING',
    'BACKUP_INTERVAL'
  ] as const;



  private static readonly CRON_REGEX = /^(\*|(\*\/\d+)|([0-5]?\d)) (\*|(\*\/\d+)|([01]?\d|2[0-3])) (\*|(\*\/\d+)|([0-2]?\d|3[01])) (\*|(\*\/\d+)|([0-9]|1[0-2])) (\*|(\*\/\d+)|([0-6]))$/;

  /**
   * Loads and validates configuration from environment variables
   * @returns Validated BackupConfig object
   * @throws ConfigurationError if validation fails
   */
  public static loadConfiguration(): BackupConfig {
    const env = process.env as Partial<EnvironmentConfig>;
    
    // Validate required fields
    this.validateRequiredFields(env);
    
    // Parse and validate individual fields
    const config: BackupConfig = {
      s3Bucket: env.S3_BUCKET!,
      s3AccessKey: env.S3_ACCESS_KEY!,
      s3SecretKey: env.S3_SECRET_KEY!,
      postgresConnectionString: env.POSTGRES_CONNECTION_STRING!,
      backupInterval: this.validateCronExpression(env.BACKUP_INTERVAL!),
      s3Path: env.S3_PATH || '',
    };

    // Add optional fields only if they have values
    if (env.S3_URL) {
      config.s3Url = env.S3_URL;
    }
    
    const retentionDays = this.parseRetentionDays(env.BACKUP_RETENTION_DAYS);
    if (retentionDays !== undefined) {
      config.retentionDays = retentionDays;
    }
    
    const logLevel = this.validateLogLevel(env.LOG_LEVEL);
    if (logLevel !== undefined) {
      config.logLevel = logLevel;
    }

    return config;
  }

  /**
   * Creates a sanitized version of configuration safe for logging
   * Excludes sensitive credentials and connection strings
   */
  public static sanitizeForLogging(config: BackupConfig): Record<string, any> {
    return {
      s3Bucket: config.s3Bucket,
      s3Url: config.s3Url || 'default (AWS S3)',
      s3Path: config.s3Path || '(root)',
      s3AccessKey: this.maskSensitiveValue(config.s3AccessKey),
      postgresConnectionString: this.maskConnectionString(config.postgresConnectionString),
      backupInterval: config.backupInterval,
      retentionDays: config.retentionDays || 'unlimited',
      logLevel: config.logLevel || 'info'
    };
  }

  /**
   * Validates that all required environment variables are present
   */
  private static validateRequiredFields(env: Partial<EnvironmentConfig>): void {
    const missing: string[] = [];
    
    for (const field of this.REQUIRED_FIELDS) {
      if (!env[field] || env[field]!.trim() === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      throw new ConfigurationError(
        `Missing required environment variables: ${missing.join(', ')}`,
        missing[0]
      );
    }
  }

  /**
   * Validates cron expression format
   */
  private static validateCronExpression(cronExpression: string): string {
    const trimmed = cronExpression.trim();
    
    if (!this.CRON_REGEX.test(trimmed)) {
      throw new ConfigurationError(
        `Invalid cron expression: ${cronExpression}. Expected format: "minute hour day month day-of-week"`,
        'BACKUP_INTERVAL'
      );
    }
    
    return trimmed;
  }

  /**
   * Parses and validates retention days
   */
  private static parseRetentionDays(value?: string): number | undefined {
    if (!value || value.trim() === '') {
      return undefined;
    }

    const trimmed = value.trim();
    
    // Check if it's a valid integer (no decimals, no non-numeric characters)
    if (!/^\d+$/.test(trimmed)) {
      throw new ConfigurationError(
        `Invalid BACKUP_RETENTION_DAYS: ${value}. Must be a positive integer`,
        'BACKUP_RETENTION_DAYS'
      );
    }

    const parsed = parseInt(trimmed, 10);
    
    if (parsed < 1) {
      throw new ConfigurationError(
        `Invalid BACKUP_RETENTION_DAYS: ${value}. Must be a positive integer`,
        'BACKUP_RETENTION_DAYS'
      );
    }

    return parsed;
  }

  /**
   * Validates log level
   */
  private static validateLogLevel(value?: string): string | undefined {
    if (!value || value.trim() === '') {
      return undefined;
    }

    const validLevels = ['error', 'warn', 'info', 'debug'];
    const level = value.trim().toLowerCase();
    
    if (!validLevels.includes(level)) {
      throw new ConfigurationError(
        `Invalid LOG_LEVEL: ${value}. Must be one of: ${validLevels.join(', ')}`,
        'LOG_LEVEL'
      );
    }

    return level;
  }

  /**
   * Masks sensitive values for logging
   */
  private static maskSensitiveValue(value: string): string {
    if (value.length <= 4) {
      return '***';
    }
    return value.substring(0, 4) + '***';
  }

  /**
   * Masks connection string for logging
   */
  private static maskConnectionString(connectionString: string): string {
    // Replace password in connection string with ***
    return connectionString.replace(/:([^:@]+)@/, ':***@');
  }
}