import { ConfigurationManager } from '../ConfigurationManager';

describe('ConfigurationManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should load configuration successfully with all required variables', () => {
      process.env['S3_BUCKET'] = 'test-bucket';
      process.env['S3_ACCESS_KEY'] = 'test-access-key';
      process.env['S3_SECRET_KEY'] = 'test-secret-key';
      process.env['POSTGRES_CONNECTION_STRING'] =
        'postgresql://localhost:5432/testdb';
      process.env['BACKUP_INTERVAL'] = '0 2 * * *';

      const configManager = new ConfigurationManager();
      const config = configManager.getConfig();

      expect(config.s3Bucket).toBe('test-bucket');
      expect(config.s3AccessKey).toBe('test-access-key');
      expect(config.s3SecretKey).toBe('test-secret-key');
      expect(config.postgresConnectionString).toBe(
        'postgresql://localhost:5432/testdb'
      );
      expect(config.backupInterval).toBe('0 2 * * *');
      expect(config.s3Path).toBe('postgres-backup');
      expect(config.logLevel).toBe('info');
    });

    it('should load configuration with optional variables', () => {
      process.env['S3_BUCKET'] = 'test-bucket';
      process.env['S3_ACCESS_KEY'] = 'test-access-key';
      process.env['S3_SECRET_KEY'] = 'test-secret-key';
      process.env['POSTGRES_CONNECTION_STRING'] =
        'postgresql://localhost:5432/testdb';
      process.env['BACKUP_INTERVAL'] = '0 2 * * *';
      process.env['S3_URL'] = 'http://localhost:9000';
      process.env['S3_PATH'] = 'custom-path';
      process.env['BACKUP_RETENTION_DAYS'] = '30';
      process.env['LOG_LEVEL'] = 'debug';

      const configManager = new ConfigurationManager();
      const config = configManager.getConfig();

      expect(config.s3Url).toBe('http://localhost:9000');
      expect(config.s3Path).toBe('custom-path');
      expect(config.retentionDays).toBe(30);
      expect(config.logLevel).toBe('debug');
    });

    it('should throw error when required environment variables are missing', () => {
      expect(() => {
        new ConfigurationManager();
      }).toThrow(
        'Missing required environment variables: S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, POSTGRES_CONNECTION_STRING, BACKUP_INTERVAL'
      );
    });

    it('should throw error when BACKUP_RETENTION_DAYS is invalid', () => {
      process.env['S3_BUCKET'] = 'test-bucket';
      process.env['S3_ACCESS_KEY'] = 'test-access-key';
      process.env['S3_SECRET_KEY'] = 'test-secret-key';
      process.env['POSTGRES_CONNECTION_STRING'] =
        'postgresql://localhost:5432/testdb';
      process.env['BACKUP_INTERVAL'] = '0 2 * * *';
      process.env['BACKUP_RETENTION_DAYS'] = 'invalid';

      expect(() => {
        new ConfigurationManager();
      }).toThrow('BACKUP_RETENTION_DAYS must be a positive integer');
    });

    it('should throw error when BACKUP_INTERVAL is invalid cron expression', () => {
      process.env['S3_BUCKET'] = 'test-bucket';
      process.env['S3_ACCESS_KEY'] = 'test-access-key';
      process.env['S3_SECRET_KEY'] = 'test-secret-key';
      process.env['POSTGRES_CONNECTION_STRING'] =
        'postgresql://localhost:5432/testdb';
      process.env['BACKUP_INTERVAL'] = 'invalid cron';

      expect(() => {
        new ConfigurationManager();
      }).toThrow('BACKUP_INTERVAL must be a valid cron expression');
    });
  });

  describe('getSanitizedConfig', () => {
    it('should return configuration with sensitive data redacted', () => {
      process.env['S3_BUCKET'] = 'test-bucket';
      process.env['S3_ACCESS_KEY'] = 'test-access-key';
      process.env['S3_SECRET_KEY'] = 'test-secret-key';
      process.env['POSTGRES_CONNECTION_STRING'] =
        'postgresql://localhost:5432/testdb';
      process.env['BACKUP_INTERVAL'] = '0 2 * * *';

      const configManager = new ConfigurationManager();
      const sanitized = configManager.getSanitizedConfig();

      expect(sanitized['s3AccessKey']).toBe('[REDACTED]');
      expect(sanitized['s3SecretKey']).toBe('[REDACTED]');
      expect(sanitized['postgresConnectionString']).toBe('[REDACTED]');
      expect(sanitized['s3Bucket']).toBe('test-bucket');
      expect(sanitized['backupInterval']).toBe('0 2 * * *');
    });
  });

  describe('validateConfiguration', () => {
    it('should return true for valid configuration', () => {
      process.env['S3_BUCKET'] = 'test-bucket';
      process.env['S3_ACCESS_KEY'] = 'test-access-key';
      process.env['S3_SECRET_KEY'] = 'test-secret-key';
      process.env['POSTGRES_CONNECTION_STRING'] =
        'postgresql://localhost:5432/testdb';
      process.env['BACKUP_INTERVAL'] = '0 2 * * *';

      const configManager = new ConfigurationManager();
      expect(configManager.validateConfiguration()).toBe(true);
    });

    it('should return false for invalid configuration', () => {
      // Test with a different approach - create a config manager with valid env first
      process.env['S3_BUCKET'] = 'test-bucket';
      process.env['S3_ACCESS_KEY'] = 'test-access-key';
      process.env['S3_SECRET_KEY'] = 'test-secret-key';
      process.env['POSTGRES_CONNECTION_STRING'] =
        'postgresql://localhost:5432/testdb';
      process.env['BACKUP_INTERVAL'] = '0 2 * * *';

      const configManager = new ConfigurationManager();

      // Now clear env and test validation
      const originalEnv = process.env;
      process.env = {};

      expect(configManager.validateConfiguration()).toBe(false);

      // Restore original env
      process.env = originalEnv;
    });
  });
});
