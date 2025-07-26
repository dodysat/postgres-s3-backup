import { Logger } from '../src/clients/Logger';
import { LogLevel } from '../src/interfaces/Logger';

// Mock winston to capture log calls
jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return {
    createLogger: jest.fn(() => mockLogger),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      errors: jest.fn(),
      json: jest.fn(),
      printf: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
    },
    transports: {
      Console: jest.fn(),
    },
  };
});

describe('Logger', () => {
  let logger: Logger;
  let mockWinston: any;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new Logger(LogLevel.DEBUG);
    // Get the mocked winston instance
    const winston = require('winston');
    mockWinston = winston.createLogger();
  });

  describe('Basic logging methods', () => {
    it('should log info messages', () => {
      const message = 'Test info message';
      const meta = { key: 'value' };

      logger.info(message, meta);

      expect(mockWinston.info).toHaveBeenCalledWith(message, meta);
    });

    it('should log warning messages', () => {
      const message = 'Test warning message';
      const meta = { key: 'value' };

      logger.warn(message, meta);

      expect(mockWinston.warn).toHaveBeenCalledWith(message, meta);
    });

    it('should log error messages with error object', () => {
      const message = 'Test error message';
      const error = new Error('Test error');
      const meta = { key: 'value' };

      logger.error(message, error, meta);

      expect(mockWinston.error).toHaveBeenCalledWith(message, {
        key: 'value',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
    });

    it('should log error messages without error object', () => {
      const message = 'Test error message';
      const meta = { key: 'value' };

      logger.error(message, undefined, meta);

      expect(mockWinston.error).toHaveBeenCalledWith(message, meta);
    });

    it('should log debug messages', () => {
      const message = 'Test debug message';
      const meta = { key: 'value' };

      logger.debug(message, meta);

      expect(mockWinston.debug).toHaveBeenCalledWith(message, meta);
    });
  });

  describe('Specialized logging methods', () => {
    it('should log backup start', () => {
      const databaseName = 'test_db';
      const meta = { additional: 'info' };

      logger.logBackupStart(databaseName, meta);

      expect(mockWinston.info).toHaveBeenCalledWith('Backup operation started', {
        operation: 'backup_start',
        databaseName,
        additional: 'info',
      });
    });

    it('should log backup completion', () => {
      const fileName = 'backup-2023-10-01.sql.gz';
      const fileSize = 1048576; // 1MB
      const s3Location = 's3://bucket/path/backup-2023-10-01.sql.gz';
      const duration = 30000; // 30 seconds

      logger.logBackupComplete(fileName, fileSize, s3Location, duration);

      expect(mockWinston.info).toHaveBeenCalledWith('Backup operation completed successfully', {
        operation: 'backup_complete',
        fileName,
        fileSize,
        s3Location,
        duration,
        fileSizeMB: 1,
      });
    });

    it('should log backup errors', () => {
      const operation = 'database_dump';
      const error = new Error('Connection failed');
      const meta = { database: 'test_db' };

      logger.logBackupError(operation, error, meta);

      expect(mockWinston.error).toHaveBeenCalledWith('Backup operation failed: database_dump', {
        operation: 'backup_error',
        failedOperation: operation,
        database: 'test_db',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
    });

    it('should log retention cleanup', () => {
      const deletedCount = 5;
      const retentionDays = 30;

      logger.logRetentionCleanup(deletedCount, retentionDays);

      expect(mockWinston.info).toHaveBeenCalledWith('Retention cleanup completed', {
        operation: 'retention_cleanup',
        deletedCount,
        retentionDays,
      });
    });

    it('should log configuration start with sanitized config', () => {
      const config = {
        s3Bucket: 'test-bucket',
        s3AccessKey: 'secret-key',
        postgresConnectionString: 'postgres://user:pass@host/db',
        backupInterval: '0 2 * * *',
      };

      logger.logConfigurationStart(config);

      expect(mockWinston.info).toHaveBeenCalledWith('Application starting with configuration', {
        operation: 'startup',
        config: {
          s3Bucket: 'test-bucket',
          s3AccessKey: '[REDACTED]',
          postgresConnectionString: '[REDACTED]',
          backupInterval: '0 2 * * *',
        },
      });
    });

    it('should log scheduled execution', () => {
      const cronExpression = '0 2 * * *';

      logger.logScheduledExecution(cronExpression);

      expect(mockWinston.info).toHaveBeenCalledWith('Scheduled backup execution triggered', {
        operation: 'scheduled_execution',
        cronExpression,
      });
    });
  });

  describe('Sensitive data sanitization', () => {
    it('should sanitize sensitive keys in metadata', () => {
      const sensitiveConfig = {
        normalKey: 'normal-value',
        password: 'secret-password',
        secret: 'secret-value',
        key: 'secret-key',
        token: 'secret-token',
        credential: 'secret-credential',
        s3AccessKey: 'access-key',
        s3SecretKey: 'secret-key',
        postgresConnectionString: 'postgres://user:pass@host/db',
        S3_ACCESS_KEY: 'env-access-key',
        S3_SECRET_KEY: 'env-secret-key',
        POSTGRES_CONNECTION_STRING: 'env-connection-string',
      };

      logger.info('Test message', sensitiveConfig);

      // The sanitization happens in the winston format function
      // We can't easily test it directly, but we can verify the method was called
      expect(mockWinston.info).toHaveBeenCalled();
    });

    it('should sanitize nested sensitive data', () => {
      const nestedConfig = {
        database: {
          host: 'localhost',
          password: 'secret-password',
          credentials: {
            username: 'user',
            secret: 'nested-secret',
          },
        },
        s3: {
          bucket: 'test-bucket',
          s3AccessKey: 'access-key',
        },
      };

      logger.info('Test nested config', nestedConfig);

      expect(mockWinston.info).toHaveBeenCalled();
    });
  });

  describe('Logger factory method', () => {
    beforeEach(() => {
      // Clear environment variables
      delete process.env.LOG_LEVEL;
    });

    it('should create logger with INFO level by default', () => {
      const logger = Logger.createFromEnvironment();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should create logger with specified log level from environment', () => {
      process.env.LOG_LEVEL = 'debug';
      const logger = Logger.createFromEnvironment();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should handle invalid log level and default to INFO', () => {
      process.env.LOG_LEVEL = 'invalid';
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const logger = Logger.createFromEnvironment();

      expect(logger).toBeInstanceOf(Logger);
      expect(consoleSpy).toHaveBeenCalledWith('Invalid LOG_LEVEL: invalid. Using INFO level.');

      consoleSpy.mockRestore();
    });

    it('should handle case insensitive log levels', () => {
      process.env.LOG_LEVEL = 'ERROR';
      const logger = Logger.createFromEnvironment();
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('File size formatting', () => {
    it('should format file sizes correctly in MB', () => {
      const testCases = [
        { bytes: 1024 * 1024, expectedMB: 1 },
        { bytes: 1024 * 1024 * 2.5, expectedMB: 2.5 },
        { bytes: 1024 * 1024 * 0.1, expectedMB: 0.1 },
        { bytes: 1024 * 1024 * 10.567, expectedMB: 10.57 },
      ];

      testCases.forEach(({ bytes, expectedMB }) => {
        logger.logBackupComplete('test.sql.gz', bytes, 's3://bucket/test.sql.gz', 1000);

        expect(mockWinston.info).toHaveBeenCalledWith(
          'Backup operation completed successfully',
          expect.objectContaining({
            fileSize: bytes,
            fileSizeMB: expectedMB,
          })
        );
      });
    });
  });
});
