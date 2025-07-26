import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigurationManager } from '../src/config/ConfigurationManager';

// Mock AWS SDK for S3 operations
jest.mock('@aws-sdk/client-s3', () => {
  const mockS3Client = {
    send: jest.fn(),
  };

  return {
    S3Client: jest.fn(() => mockS3Client),
    PutObjectCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    HeadBucketCommand: jest.fn(),
  };
});

// Mock pg_dump process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
  validate: jest.fn(),
}));

describe('Integration Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let testTempDir: string;
  let mockSpawn: jest.MockedFunction<typeof spawn>;

  beforeAll(async () => {
    // Save original environment
    originalEnv = { ...process.env };

    // Create temporary directory for test files
    testTempDir = await fs.mkdtemp(join(tmpdir(), 'postgres-backup-test-'));

    // Setup AWS SDK mocks
    const { S3Client } = require('@aws-sdk/client-s3');
    new S3Client(); // Initialize for mocking

    // Setup child_process mocks
    mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
  });

  afterAll(async () => {
    // Restore original environment
    process.env = originalEnv;

    // Cleanup test directory
    try {
      await fs.rm(testTempDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset environment to clean state
    process.env = { ...originalEnv };

    // Clear backup-related env vars
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.POSTGRES_CONNECTION_STRING;
    delete process.env.BACKUP_INTERVAL;
    delete process.env.S3_URL;
    delete process.env.S3_PATH;
    delete process.env.BACKUP_RETENTION_DAYS;
    delete process.env.LOG_LEVEL;

    // Mock console methods to reduce test noise
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Configuration Integration', () => {
    it('should load and validate complete configuration', () => {
      // Arrange
      const validConfig = {
        S3_BUCKET: 'test-bucket',
        S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
        S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
        BACKUP_INTERVAL: '0 2 * * *',
        S3_PATH: 'integration-test-backups',
        BACKUP_RETENTION_DAYS: '7',
        LOG_LEVEL: 'info',
      };

      Object.assign(process.env, validConfig);

      // Act
      const config = ConfigurationManager.loadConfiguration();

      // Assert
      expect(config.s3Bucket).toBe('test-bucket');
      expect(config.s3AccessKey).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(config.postgresConnectionString).toBe(
        'postgresql://testuser:testpass@localhost:5432/testdb'
      );
      expect(config.backupInterval).toBe('0 2 * * *');
      expect(config.s3Path).toBe('integration-test-backups');
      expect(config.retentionDays).toBe(7);
      expect(config.logLevel).toBe('info');
    });

    it('should handle missing required configuration', () => {
      // Arrange - Missing required variables

      // Act & Assert
      expect(() => ConfigurationManager.loadConfiguration()).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Missing required environment variables'),
        })
      );
    });

    it('should validate cron expression format', () => {
      // Arrange
      const configWithInvalidCron = {
        S3_BUCKET: 'test-bucket',
        S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
        S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
        BACKUP_INTERVAL: 'not-a-cron-expression',
      };

      Object.assign(process.env, configWithInvalidCron);

      // Act & Assert
      expect(() => ConfigurationManager.loadConfiguration()).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Invalid cron expression'),
          field: 'BACKUP_INTERVAL',
        })
      );
    });

    it('should sanitize sensitive information in configuration logging', () => {
      // Arrange
      const configWithSensitiveData = {
        S3_BUCKET: 'test-bucket',
        S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
        S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        POSTGRES_CONNECTION_STRING: 'postgresql://testuser:secretpassword@localhost:5432/testdb',
        BACKUP_INTERVAL: '0 2 * * *',
      };

      Object.assign(process.env, configWithSensitiveData);

      // Act
      const config = ConfigurationManager.loadConfiguration();
      const sanitized = ConfigurationManager.sanitizeForLogging(config);

      // Assert
      expect(sanitized.s3AccessKey).toBe('AKIA***');
      expect(sanitized.postgresConnectionString).toBe(
        'postgresql://testuser:***@localhost:5432/testdb'
      );
      expect(sanitized.s3Bucket).toBe('test-bucket'); // Non-sensitive data preserved
    });
  });

  describe('Mock Integration Verification', () => {
    it('should verify AWS SDK mocking is working', () => {
      // Arrange
      const { S3Client, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

      // Act
      const s3Client = new S3Client();
      new PutObjectCommand({});
      new HeadBucketCommand({});

      // Assert
      expect(S3Client).toHaveBeenCalled();
      expect(PutObjectCommand).toHaveBeenCalled();
      expect(HeadBucketCommand).toHaveBeenCalled();
      expect(s3Client.send).toBeDefined();
    });

    it('should verify child_process mocking is working', () => {
      // Arrange
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      // Act
      const result = spawn('test-command', ['arg1', 'arg2']);

      // Assert
      expect(mockSpawn).toHaveBeenCalledWith('test-command', ['arg1', 'arg2']);
      expect(result).toBe(mockProcess);
    });

    it('should verify node-cron mocking is working', () => {
      // Arrange
      const nodeCron = require('node-cron');
      const mockJob = {
        start: jest.fn(),
        stop: jest.fn(),
        destroy: jest.fn(),
      };

      nodeCron.validate.mockReturnValue(true);
      nodeCron.schedule.mockReturnValue(mockJob);

      // Act
      const isValid = nodeCron.validate('0 2 * * *');
      const job = nodeCron.schedule('0 2 * * *', () => {});

      // Assert
      expect(isValid).toBe(true);
      expect(nodeCron.schedule).toHaveBeenCalledWith('0 2 * * *', expect.any(Function));
      expect(job).toBe(mockJob);
    });
  });

  describe('File System Integration', () => {
    it('should create and cleanup temporary files', async () => {
      // Arrange
      const testFile = join(testTempDir, 'test-file.txt');
      const testContent = 'test content';

      // Act
      await fs.writeFile(testFile, testContent);
      const readContent = await fs.readFile(testFile, 'utf8');
      await fs.unlink(testFile);

      // Assert
      expect(readContent).toBe(testContent);

      // Verify file was deleted
      await expect(fs.access(testFile)).rejects.toThrow();
    });

    it('should handle file operations with proper error handling', async () => {
      // Arrange
      const nonExistentFile = join(testTempDir, 'non-existent.txt');

      // Act & Assert
      await expect(fs.readFile(nonExistentFile)).rejects.toThrow();
      await expect(fs.unlink(nonExistentFile)).rejects.toThrow();
    });
  });

  describe('Environment Variable Precedence', () => {
    it('should handle environment variable override scenarios', () => {
      // Arrange - Test Docker Compose environment variable override
      const baseConfig = {
        S3_BUCKET: 'base-bucket',
        S3_ACCESS_KEY: 'base-key',
        S3_SECRET_KEY: 'base-secret',
        POSTGRES_CONNECTION_STRING: 'postgresql://base:base@localhost:5432/base',
        BACKUP_INTERVAL: '0 1 * * *',
      };

      const dockerOverrides = {
        S3_BUCKET: 'docker-override-bucket',
        S3_PATH: 'docker-override-path',
        BACKUP_RETENTION_DAYS: '7',
        LOG_LEVEL: 'debug',
      };

      // Apply base config first, then Docker overrides
      Object.assign(process.env, baseConfig, dockerOverrides);

      // Act
      const config = ConfigurationManager.loadConfiguration();

      // Assert
      expect(config.s3Bucket).toBe('docker-override-bucket'); // Overridden
      expect(config.s3Path).toBe('docker-override-path'); // Added by Docker
      expect(config.retentionDays).toBe(7); // Added by Docker
      expect(config.logLevel).toBe('debug'); // Added by Docker
      expect(config.backupInterval).toBe('0 1 * * *'); // From base config
    });

    it('should handle optional environment variables correctly', () => {
      // Arrange
      const minimalConfig = {
        S3_BUCKET: 'test-bucket',
        S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
        S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
        BACKUP_INTERVAL: '0 2 * * *',
      };

      Object.assign(process.env, minimalConfig);

      // Act
      const config = ConfigurationManager.loadConfiguration();

      // Assert
      expect(config.s3Bucket).toBe('test-bucket');
      expect(config.backupInterval).toBe('0 2 * * *');
      expect(config.s3Url).toBeUndefined();
      expect(config.s3Path).toBe('');
      expect(config.retentionDays).toBeUndefined();
      expect(config.logLevel).toBeUndefined();
    });
  });

  describe('Cron Expression Validation', () => {
    const validCronExpressions = [
      { expression: '0 2 * * *', description: 'daily at 2 AM' },
      { expression: '*/15 * * * *', description: 'every 15 minutes' },
      { expression: '0 0 1 * *', description: 'monthly on 1st' },
      { expression: '0 0 * * 0', description: 'weekly on Sunday' },
      { expression: '30 6 * * 1', description: 'weekly on Monday at 6:30 AM' },
      { expression: '0 */6 * * *', description: 'every 6 hours' },
      { expression: '15 14 1 * *', description: 'monthly on 1st at 2:15 PM' },
    ];

    const invalidCronExpressions = [
      { expression: 'invalid', description: 'single word' },
      { expression: '0 2 * *', description: 'missing field' },
      { expression: '0 2 * * * *', description: 'extra field' },
      { expression: '60 2 * * *', description: 'minute > 59' },
      { expression: '0 25 * * *', description: 'hour > 23' },
      { expression: '0 0 32 * *', description: 'day > 31' },
      { expression: '0 0 * 13 *', description: 'month > 12' },
      { expression: '0 0 * * 8', description: 'day of week > 7' },
    ];

    validCronExpressions.forEach(({ expression, description }) => {
      it(`should accept valid ${description}: "${expression}"`, () => {
        // Arrange
        const testConfig = {
          S3_BUCKET: 'test-bucket',
          S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
          S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
          BACKUP_INTERVAL: expression,
        };

        Object.assign(process.env, testConfig);

        // Act & Assert
        expect(() => ConfigurationManager.loadConfiguration()).not.toThrow();
        const config = ConfigurationManager.loadConfiguration();
        expect(config.backupInterval).toBe(expression);
      });
    });

    invalidCronExpressions.forEach(({ expression, description }) => {
      it(`should reject invalid ${description}: "${expression}"`, () => {
        // Arrange
        const testConfig = {
          S3_BUCKET: 'test-bucket',
          S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
          S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
          BACKUP_INTERVAL: expression,
        };

        Object.assign(process.env, testConfig);

        // Act & Assert
        expect(() => ConfigurationManager.loadConfiguration()).toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Invalid cron expression'),
          })
        );
      });
    });
  });

  describe('Retention Days Validation', () => {
    it('should accept valid retention days', () => {
      // Arrange
      const testConfig = {
        S3_BUCKET: 'test-bucket',
        S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
        S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
        BACKUP_INTERVAL: '0 2 * * *',
        BACKUP_RETENTION_DAYS: '30',
      };

      Object.assign(process.env, testConfig);

      // Act
      const config = ConfigurationManager.loadConfiguration();

      // Assert
      expect(config.retentionDays).toBe(30);
    });

    it('should reject invalid retention days', () => {
      const invalidValues = ['0', '-1', 'abc', '30.5', 'thirty'];

      invalidValues.forEach(value => {
        // Arrange
        const testConfig = {
          S3_BUCKET: 'test-bucket',
          S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
          S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
          BACKUP_INTERVAL: '0 2 * * *',
          BACKUP_RETENTION_DAYS: value,
        };

        Object.assign(process.env, testConfig);

        // Act & Assert
        expect(() => ConfigurationManager.loadConfiguration()).toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Invalid BACKUP_RETENTION_DAYS'),
            field: 'BACKUP_RETENTION_DAYS',
          })
        );
      });
    });
  });

  describe('Log Level Validation', () => {
    it('should accept valid log levels', () => {
      const validLevels = ['error', 'warn', 'info', 'debug', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

      validLevels.forEach(level => {
        // Arrange
        const testConfig = {
          S3_BUCKET: 'test-bucket',
          S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
          S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
          BACKUP_INTERVAL: '0 2 * * *',
          LOG_LEVEL: level,
        };

        Object.assign(process.env, testConfig);

        // Act
        const config = ConfigurationManager.loadConfiguration();

        // Assert
        expect(config.logLevel).toBe(level.toLowerCase());
      });
    });

    it('should reject invalid log levels', () => {
      const invalidLevels = ['trace', 'verbose', 'invalid', '123'];

      invalidLevels.forEach(level => {
        // Arrange
        const testConfig = {
          S3_BUCKET: 'test-bucket',
          S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
          S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
          BACKUP_INTERVAL: '0 2 * * *',
          LOG_LEVEL: level,
        };

        Object.assign(process.env, testConfig);

        // Act & Assert
        expect(() => ConfigurationManager.loadConfiguration()).toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Invalid LOG_LEVEL'),
            field: 'LOG_LEVEL',
          })
        );
      });
    });
  });
});
