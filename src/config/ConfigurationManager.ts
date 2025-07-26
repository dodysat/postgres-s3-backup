import { BackupConfig } from '../interfaces/BackupConfig';

export class ConfigurationManager {
  private config: BackupConfig;

  constructor() {
    this.config = this.loadConfiguration();
  }

  public getConfig(): BackupConfig {
    return this.config;
  }

  private loadConfiguration(): BackupConfig {
    const env = process.env;

    // Validate required environment variables
    const requiredVars = [
      'S3_BUCKET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'POSTGRES_CONNECTION_STRING',
      'BACKUP_INTERVAL',
    ];

    const missingVars = requiredVars.filter((varName) => !env[varName]);

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(', ')}`
      );
    }

    // Parse retention days if provided
    let retentionDays: number | undefined;
    if (env['BACKUP_RETENTION_DAYS']) {
      const parsed = parseInt(env['BACKUP_RETENTION_DAYS'], 10);
      if (isNaN(parsed) || parsed < 0) {
        throw new Error('BACKUP_RETENTION_DAYS must be a positive integer');
      }
      retentionDays = parsed;
    }

    // Validate cron expression
    const backupInterval = env['BACKUP_INTERVAL'];
    if (!backupInterval || !this.isValidCronExpression(backupInterval)) {
      throw new Error('BACKUP_INTERVAL must be a valid cron expression');
    }

    const config: BackupConfig = {
      s3Bucket: env['S3_BUCKET']!,
      s3Path: env['S3_PATH'] || 'postgres-backup',
      s3AccessKey: env['S3_ACCESS_KEY']!,
      s3SecretKey: env['S3_SECRET_KEY']!,
      postgresConnectionString: env['POSTGRES_CONNECTION_STRING']!,
      backupInterval,
      logLevel: env['LOG_LEVEL'] || 'info',
    };

    // Add optional properties only if they exist
    if (env['S3_URL']) {
      config.s3Url = env['S3_URL'];
    }
    if (retentionDays !== undefined) {
      config.retentionDays = retentionDays;
    }

    return config;
  }

  private isValidCronExpression(cronExpression: string): boolean {
    // Basic cron validation - 5 or 6 fields
    const cronParts = cronExpression.trim().split(/\s+/);
    if (cronParts.length !== 5 && cronParts.length !== 6) {
      return false;
    }

    // Validate each part has valid characters
    const validChars = /^[\d*/,\-?LW#]+$/;
    return cronParts.every((part) => validChars.test(part));
  }

  public getSanitizedConfig(): Record<string, unknown> {
    const sanitized = { ...this.config } as any;
    delete sanitized.s3AccessKey;
    delete sanitized.s3SecretKey;
    delete sanitized.postgresConnectionString;
    return {
      ...sanitized,
      s3AccessKey: '[REDACTED]',
      s3SecretKey: '[REDACTED]',
      postgresConnectionString: '[REDACTED]',
    };
  }

  public validateConfiguration(): boolean {
    try {
      this.loadConfiguration();
      return true;
    } catch (error) {
      return false;
    }
  }
}
