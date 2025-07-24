import { ConfigurationManager, ConfigurationError } from '../src/config/ConfigurationManager';
import { BackupConfig } from '../src/interfaces/BackupConfig';

describe('ConfigurationManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    
    // Clear all backup-related env vars
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.POSTGRES_CONNECTION_STRING;
    delete process.env.BACKUP_INTERVAL;
    delete process.env.S3_URL;
    delete process.env.S3_PATH;
    delete process.env.BACKUP_RETENTION_DAYS;
    delete process.env.LOG_LEVEL;
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadConfiguration', () => {
    const validEnvVars = {
      S3_BUCKET: 'test-bucket',
      S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
      S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      POSTGRES_CONNECTION_STRING: 'postgresql://user:password@localhost:5432/testdb',
      BACKUP_INTERVAL: '0 2 * * *'
    };

    it('should load valid configuration with all required fields', () => {
      Object.assign(process.env, validEnvVars);

      const config = ConfigurationManager.loadConfiguration();

      expect(config).toEqual({
        s3Bucket: 'test-bucket',
        s3AccessKey: 'AKIAIOSFODNN7EXAMPLE',
        s3SecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        postgresConnectionString: 'postgresql://user:password@localhost:5432/testdb',
        backupInterval: '0 2 * * *',
        s3Url: undefined,
        s3Path: '',
        retentionDays: undefined,
        logLevel: undefined
      });
    });

    it('should load configuration with optional fields', () => {
      Object.assign(process.env, {
        ...validEnvVars,
        S3_URL: 'https://s3.custom-endpoint.com',
        S3_PATH: 'backups/postgres',
        BACKUP_RETENTION_DAYS: '30',
        LOG_LEVEL: 'debug'
      });

      const config = ConfigurationManager.loadConfiguration();

      expect(config.s3Url).toBe('https://s3.custom-endpoint.com');
      expect(config.s3Path).toBe('backups/postgres');
      expect(config.retentionDays).toBe(30);
      expect(config.logLevel).toBe('debug');
    });

    describe('required field validation', () => {
      it('should throw error when S3_BUCKET is missing', () => {
        const envWithoutBucket = { ...validEnvVars };
        (envWithoutBucket as any).S3_BUCKET = undefined;
        Object.assign(process.env, envWithoutBucket);

        expect(() => ConfigurationManager.loadConfiguration())
          .toThrow(new ConfigurationError('Missing required environment variables: S3_BUCKET', 'S3_BUCKET'));
      });

      it('should throw error when S3_ACCESS_KEY is missing', () => {
        const envWithoutAccessKey = { ...validEnvVars };
        (envWithoutAccessKey as any).S3_ACCESS_KEY = undefined;
        Object.assign(process.env, envWithoutAccessKey);

        expect(() => ConfigurationManager.loadConfiguration())
          .toThrow(new ConfigurationError('Missing required environment variables: S3_ACCESS_KEY', 'S3_ACCESS_KEY'));
      });

      it('should throw error when S3_SECRET_KEY is missing', () => {
        const envWithoutSecretKey = { ...validEnvVars };
        (envWithoutSecretKey as any).S3_SECRET_KEY = undefined;
        Object.assign(process.env, envWithoutSecretKey);

        expect(() => ConfigurationManager.loadConfiguration())
          .toThrow(new ConfigurationError('Missing required environment variables: S3_SECRET_KEY', 'S3_SECRET_KEY'));
      });

      it('should throw error when POSTGRES_CONNECTION_STRING is missing', () => {
        const envWithoutPostgres = { ...validEnvVars };
        (envWithoutPostgres as any).POSTGRES_CONNECTION_STRING = undefined;
        Object.assign(process.env, envWithoutPostgres);

        expect(() => ConfigurationManager.loadConfiguration())
          .toThrow(new ConfigurationError('Missing required environment variables: POSTGRES_CONNECTION_STRING', 'POSTGRES_CONNECTION_STRING'));
      });

      it('should throw error when BACKUP_INTERVAL is missing', () => {
        const envWithoutInterval = { ...validEnvVars };
        (envWithoutInterval as any).BACKUP_INTERVAL = undefined;
        Object.assign(process.env, envWithoutInterval);

        expect(() => ConfigurationManager.loadConfiguration())
          .toThrow(new ConfigurationError('Missing required environment variables: BACKUP_INTERVAL', 'BACKUP_INTERVAL'));
      });

      it('should throw error when multiple required fields are missing', () => {
        process.env.S3_BUCKET = 'test-bucket';
        // Missing all other required fields

        expect(() => ConfigurationManager.loadConfiguration())
          .toThrow(new ConfigurationError('Missing required environment variables: S3_ACCESS_KEY, S3_SECRET_KEY, POSTGRES_CONNECTION_STRING, BACKUP_INTERVAL', 'S3_ACCESS_KEY'));
      });

      it('should throw error when required field is empty string', () => {
        Object.assign(process.env, {
          ...validEnvVars,
          S3_BUCKET: '   ' // whitespace only
        });

        expect(() => ConfigurationManager.loadConfiguration())
          .toThrow(new ConfigurationError('Missing required environment variables: S3_BUCKET', 'S3_BUCKET'));
      });
    });

    describe('cron expression validation', () => {
      it('should accept valid cron expressions', () => {
        const validCronExpressions = [
          '0 2 * * *',     // Daily at 2 AM
          '*/15 * * * *',  // Every 15 minutes
          '0 0 1 * *',     // Monthly on 1st
          '0 12 * * 1',    // Weekly on Monday at noon
          '30 6 * * 0'     // Weekly on Sunday at 6:30 AM
        ];

        validCronExpressions.forEach(cronExpr => {
          Object.assign(process.env, {
            ...validEnvVars,
            BACKUP_INTERVAL: cronExpr
          });

          const config = ConfigurationManager.loadConfiguration();
          expect(config.backupInterval).toBe(cronExpr);
        });
      });

      it('should reject invalid cron expressions', () => {
        const invalidCronExpressions = [
          'invalid',
          '0 25 * * *',    // Invalid hour (25)
          '60 * * * *',    // Invalid minute (60)
          '0 0 32 * *',    // Invalid day (32)
          '0 0 * 13 *',    // Invalid month (13)
          '0 0 * * 8',     // Invalid day of week (8)
          '0 2 * *',       // Missing field
          '0 2 * * * *'    // Extra field
        ];

        invalidCronExpressions.forEach(cronExpr => {
          Object.assign(process.env, {
            ...validEnvVars,
            BACKUP_INTERVAL: cronExpr
          });

          expect(() => ConfigurationManager.loadConfiguration())
            .toThrow(new ConfigurationError(`Invalid cron expression: ${cronExpr}. Expected format: "minute hour day month day-of-week"`, 'BACKUP_INTERVAL'));
        });
      });
    });

    describe('retention days validation', () => {
      it('should accept valid retention days', () => {
        Object.assign(process.env, {
          ...validEnvVars,
          BACKUP_RETENTION_DAYS: '30'
        });

        const config = ConfigurationManager.loadConfiguration();
        expect(config.retentionDays).toBe(30);
      });

      it('should handle undefined retention days', () => {
        Object.assign(process.env, validEnvVars);

        const config = ConfigurationManager.loadConfiguration();
        expect(config.retentionDays).toBeUndefined();
      });

      it('should handle empty retention days', () => {
        Object.assign(process.env, {
          ...validEnvVars,
          BACKUP_RETENTION_DAYS: ''
        });

        const config = ConfigurationManager.loadConfiguration();
        expect(config.retentionDays).toBeUndefined();
      });

      it('should reject invalid retention days', () => {
        const invalidValues = ['0', '-1', 'abc', '30.5', 'thirty'];

        invalidValues.forEach(value => {
          Object.assign(process.env, {
            ...validEnvVars,
            BACKUP_RETENTION_DAYS: value
          });

          expect(() => ConfigurationManager.loadConfiguration())
            .toThrow(new ConfigurationError(`Invalid BACKUP_RETENTION_DAYS: ${value}. Must be a positive integer`, 'BACKUP_RETENTION_DAYS'));
        });
      });
    });

    describe('log level validation', () => {
      it('should accept valid log levels', () => {
        const validLevels = ['error', 'warn', 'info', 'debug', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

        validLevels.forEach(level => {
          Object.assign(process.env, {
            ...validEnvVars,
            LOG_LEVEL: level
          });

          const config = ConfigurationManager.loadConfiguration();
          expect(config.logLevel).toBe(level.toLowerCase());
        });
      });

      it('should handle undefined log level', () => {
        Object.assign(process.env, validEnvVars);

        const config = ConfigurationManager.loadConfiguration();
        expect(config.logLevel).toBeUndefined();
      });

      it('should reject invalid log levels', () => {
        const invalidLevels = ['trace', 'verbose', 'invalid', '123'];

        invalidLevels.forEach(level => {
          Object.assign(process.env, {
            ...validEnvVars,
            LOG_LEVEL: level
          });

          expect(() => ConfigurationManager.loadConfiguration())
            .toThrow(new ConfigurationError(`Invalid LOG_LEVEL: ${level}. Must be one of: error, warn, info, debug`, 'LOG_LEVEL'));
        });
      });
    });
  });

  describe('sanitizeForLogging', () => {
    const sampleConfig: BackupConfig = {
      s3Bucket: 'test-bucket',
      s3AccessKey: 'AKIAIOSFODNN7EXAMPLE',
      s3SecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      postgresConnectionString: 'postgresql://user:password@localhost:5432/testdb',
      backupInterval: '0 2 * * *',
      s3Url: 'https://s3.custom-endpoint.com',
      s3Path: 'backups/postgres',
      retentionDays: 30,
      logLevel: 'info'
    };

    it('should sanitize sensitive fields', () => {
      const sanitized = ConfigurationManager.sanitizeForLogging(sampleConfig);

      expect(sanitized.s3AccessKey).toBe('AKIA***');
      expect(sanitized.postgresConnectionString).toBe('postgresql://user:***@localhost:5432/testdb');
      expect(sanitized.s3Bucket).toBe('test-bucket');
      expect(sanitized.backupInterval).toBe('0 2 * * *');
    });

    it('should handle short sensitive values', () => {
      const configWithShortKey: BackupConfig = {
        ...sampleConfig,
        s3AccessKey: 'ABC'
      };

      const sanitized = ConfigurationManager.sanitizeForLogging(configWithShortKey);
      expect(sanitized.s3AccessKey).toBe('***');
    });

    it('should handle optional fields with defaults', () => {
      const minimalConfig: BackupConfig = {
        s3Bucket: 'test-bucket',
        s3AccessKey: 'AKIAIOSFODNN7EXAMPLE',
        s3SecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        postgresConnectionString: 'postgresql://user:password@localhost:5432/testdb',
        backupInterval: '0 2 * * *',
        s3Path: ''
      };

      const sanitized = ConfigurationManager.sanitizeForLogging(minimalConfig);

      expect(sanitized.s3Url).toBe('default (AWS S3)');
      expect(sanitized.s3Path).toBe('(root)');
      expect(sanitized.retentionDays).toBe('unlimited');
      expect(sanitized.logLevel).toBe('info');
    });

    it('should handle connection strings without passwords', () => {
      const configWithoutPassword: BackupConfig = {
        ...sampleConfig,
        postgresConnectionString: 'postgresql://localhost:5432/testdb'
      };

      const sanitized = ConfigurationManager.sanitizeForLogging(configWithoutPassword);
      expect(sanitized.postgresConnectionString).toBe('postgresql://localhost:5432/testdb');
    });
  });

  describe('ConfigurationError', () => {
    it('should create error with message and field', () => {
      const error = new ConfigurationError('Test error', 'TEST_FIELD');
      
      expect(error.message).toBe('Test error');
      expect(error.field).toBe('TEST_FIELD');
      expect(error.name).toBe('ConfigurationError');
      expect(error).toBeInstanceOf(Error);
    });

    it('should create error with message only', () => {
      const error = new ConfigurationError('Test error');
      
      expect(error.message).toBe('Test error');
      expect(error.field).toBeUndefined();
      expect(error.name).toBe('ConfigurationError');
    });
  });
});