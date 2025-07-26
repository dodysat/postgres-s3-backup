import {
  BackupManager,
  BackupError,
  ValidationError,
  RetryableError,
} from '../src/clients/BackupManager';
import { PostgreSQLClient } from '../src/interfaces/PostgreSQLClient';
import { S3Client } from '../src/interfaces/S3Client';
import { RetentionManager } from '../src/interfaces/RetentionManager';
import { BackupConfig } from '../src/interfaces/BackupConfig';
import { BackupInfo } from '../src/interfaces/PostgreSQLClient';
import { promises as fs } from 'fs';

// Mock the fs module
jest.mock('fs', () => ({
  promises: {
    unlink: jest.fn(),
  },
}));

describe('BackupManager', () => {
  let backupManager: BackupManager;
  let mockPostgresClient: jest.Mocked<PostgreSQLClient>;
  let mockS3Client: jest.Mocked<S3Client>;
  let mockRetentionManager: jest.Mocked<RetentionManager>;
  let mockConfig: BackupConfig;
  let mockFs: jest.Mocked<typeof fs>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock fs
    mockFs = fs as jest.Mocked<typeof fs>;
    mockFs.unlink.mockResolvedValue(undefined);

    // Create mock clients
    mockPostgresClient = {
      testConnection: jest.fn(),
      createBackup: jest.fn(),
      getDatabaseName: jest.fn(),
    };

    mockS3Client = {
      uploadFile: jest.fn(),
      listObjects: jest.fn(),
      deleteObject: jest.fn(),
      testConnection: jest.fn(),
    };

    mockRetentionManager = {
      cleanupExpiredBackups: jest.fn(),
      isBackupExpired: jest.fn(),
      extractTimestampFromKey: jest.fn(),
    };

    // Create mock config
    mockConfig = {
      s3Bucket: 'test-bucket',
      s3Path: 'backups',
      s3AccessKey: 'test-key',
      s3SecretKey: 'test-secret',
      postgresConnectionString: 'postgresql://user:pass@localhost/testdb',
      backupInterval: '0 2 * * *', // Daily at 2 AM
      retentionDays: 30,
    };

    // Create BackupManager instance
    backupManager = new BackupManager(
      mockPostgresClient,
      mockS3Client,
      mockRetentionManager,
      mockConfig
    );

    // Mock console methods to avoid test output noise
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('executeBackup', () => {
    it('should successfully execute a complete backup operation', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-2024-01-15_14-30-45.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date('2024-01-15T14:30:45Z'),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue(
        's3://test-bucket/backups/postgres-backup-2024-01-15_14-30-45.sql.gz'
      );
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 2,
        totalCount: 10,
        deletedKeys: ['old-backup-1.sql.gz', 'old-backup-2.sql.gz'],
        errors: [],
      });

      // Act
      const result = await backupManager.executeBackup();

      // Assert
      expect(result.success).toBe(true);
      expect(result.fileName).toMatch(
        /^postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/
      );
      expect(result.fileSize).toBe(1024000);
      expect(result.s3Location).toBe(
        's3://test-bucket/backups/postgres-backup-2024-01-15_14-30-45.sql.gz'
      );
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();

      // Verify all steps were called
      expect(mockPostgresClient.createBackup).toHaveBeenCalledWith(
        expect.stringMatching(/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/)
      );
      expect(mockS3Client.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/),
        expect.stringMatching(
          /^backups\/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/
        )
      );
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringMatching(/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/)
      );
    });

    it('should handle PostgreSQL backup failure', async () => {
      // Arrange
      const backupError = new Error('Database connection failed');
      mockPostgresClient.createBackup.mockRejectedValue(backupError);

      // Act
      const result = await backupManager.executeBackup();

      // Assert
      expect(result.success).toBe(false);
      expect(result.fileName).toBe('');
      expect(result.fileSize).toBe(0);
      expect(result.s3Location).toBe('');
      expect(result.error).toContain('Database connection failed');
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Verify S3 upload was not called
      expect(mockS3Client.uploadFile).not.toHaveBeenCalled();
      expect(mockRetentionManager.cleanupExpiredBackups).not.toHaveBeenCalled();
    });

    it('should handle S3 upload failure and cleanup temp file', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-2024-01-15_14-30-45.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date('2024-01-15T14:30:45Z'),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockRejectedValue(new Error('S3 upload failed'));

      // Act
      const result = await backupManager.executeBackup();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: S3 upload failed');

      // Verify temp file cleanup was attempted
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringMatching(/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/)
      );

      // Verify retention cleanup was not called
      expect(mockRetentionManager.cleanupExpiredBackups).not.toHaveBeenCalled();
    });

    it('should continue backup even if retention cleanup fails', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-2024-01-15_14-30-45.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date('2024-01-15T14:30:45Z'),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue(
        's3://test-bucket/backups/postgres-backup-2024-01-15_14-30-45.sql.gz'
      );
      mockRetentionManager.cleanupExpiredBackups.mockRejectedValue(
        new Error('Retention cleanup failed')
      );

      // Act
      const result = await backupManager.executeBackup();

      // Assert - backup should still succeed
      expect(result.success).toBe(true);
      expect(result.fileSize).toBe(1024000);
      expect(result.error).toBeUndefined();

      // Verify all main steps were called
      expect(mockPostgresClient.createBackup).toHaveBeenCalled();
      expect(mockS3Client.uploadFile).toHaveBeenCalled();
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it('should handle temp file cleanup failure gracefully', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-2024-01-15_14-30-45.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date('2024-01-15T14:30:45Z'),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue(
        's3://test-bucket/backups/postgres-backup-2024-01-15_14-30-45.sql.gz'
      );
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 5,
        deletedKeys: [],
        errors: [],
      });

      // Mock file cleanup to fail with non-ENOENT error
      const permissionError = new Error('Permission denied') as any;
      permissionError.code = 'EPERM';
      mockFs.unlink.mockRejectedValue(permissionError);

      // Act
      const result = await backupManager.executeBackup();

      // Assert - backup should fail due to cleanup error
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should ignore ENOENT errors during temp file cleanup', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-2024-01-15_14-30-45.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date('2024-01-15T14:30:45Z'),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue(
        's3://test-bucket/backups/postgres-backup-2024-01-15_14-30-45.sql.gz'
      );
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 5,
        deletedKeys: [],
        errors: [],
      });

      // Mock file cleanup to fail with ENOENT (file not found)
      const enoentError = new Error('File not found') as any;
      enoentError.code = 'ENOENT';
      mockFs.unlink.mockRejectedValue(enoentError);

      // Act
      const result = await backupManager.executeBackup();

      // Assert - should succeed and ignore ENOENT error
      expect(result.success).toBe(true);
    });
  });

  describe('validateConfiguration', () => {
    it('should return true when all validations pass', async () => {
      // Arrange
      mockPostgresClient.testConnection.mockResolvedValue(true);
      mockS3Client.testConnection.mockResolvedValue(true);

      // Act
      const result = await backupManager.validateConfiguration();

      // Assert
      expect(result).toBe(true);
      expect(mockPostgresClient.testConnection).toHaveBeenCalled();
      expect(mockS3Client.testConnection).toHaveBeenCalled();
    });

    it('should return false when PostgreSQL connection fails', async () => {
      // Arrange
      mockPostgresClient.testConnection.mockResolvedValue(false);
      mockS3Client.testConnection.mockResolvedValue(true);

      // Act
      const result = await backupManager.validateConfiguration();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when S3 connection fails', async () => {
      // Arrange
      mockPostgresClient.testConnection.mockResolvedValue(true);
      mockS3Client.testConnection.mockResolvedValue(false);

      // Act
      const result = await backupManager.validateConfiguration();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when cron expression is invalid', async () => {
      // Arrange
      mockPostgresClient.testConnection.mockResolvedValue(true);
      mockS3Client.testConnection.mockResolvedValue(true);

      // Create manager with invalid cron
      const invalidConfig = { ...mockConfig, backupInterval: 'invalid-cron' };
      const invalidManager = new BackupManager(
        mockPostgresClient,
        mockS3Client,
        mockRetentionManager,
        invalidConfig
      );

      // Act
      const result = await invalidManager.validateConfiguration();

      // Assert
      expect(result).toBe(false);
    });

    it('should handle validation exceptions', async () => {
      // Arrange
      mockPostgresClient.testConnection.mockRejectedValue(new Error('Connection error'));

      // Act
      const result = await backupManager.validateConfiguration();

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('filename generation', () => {
    it('should generate filename with correct timestamp format', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-test.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date(),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue(
        's3://test-bucket/backups/postgres-backup-test.sql.gz'
      );
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });

      // Act
      const result = await backupManager.executeBackup();

      // Assert - Check that filename follows the correct format
      expect(result.fileName).toMatch(
        /^postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/
      );

      // Verify the timestamp format is valid by parsing it
      const timestampMatch = result.fileName.match(
        /postgres-backup-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.sql\.gz/
      );
      expect(timestampMatch).not.toBeNull();

      if (timestampMatch) {
        const timestampStr = timestampMatch[1];
        // Convert to ISO format and verify it's a valid date
        const isoTimestamp = timestampStr.replace('_', 'T').replace(/-/g, (match, offset) => {
          return offset > 10 ? ':' : match;
        });
        const parsedDate = new Date(isoTimestamp);
        expect(parsedDate.getTime()).not.toBeNaN();
      }
    });
  });

  describe('S3 key generation', () => {
    it('should generate S3 key with path prefix', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/test-backup.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date(),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue('s3://test-bucket/backups/test-backup.sql.gz');
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });

      // Act
      await backupManager.executeBackup();

      // Assert
      expect(mockS3Client.uploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(
          /^backups\/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/
        )
      );
    });

    it('should generate S3 key without path prefix when s3Path is empty', async () => {
      // Arrange
      const configWithoutPath = { ...mockConfig, s3Path: '' };
      const managerWithoutPath = new BackupManager(
        mockPostgresClient,
        mockS3Client,
        mockRetentionManager,
        configWithoutPath
      );

      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/test-backup.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date(),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue('s3://test-bucket/test-backup.sql.gz');
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });

      // Act
      await managerWithoutPath.executeBackup();

      // Assert
      expect(mockS3Client.uploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/)
      );
    });

    it('should normalize S3 path by removing leading and trailing slashes', async () => {
      // Arrange
      const configWithSlashes = { ...mockConfig, s3Path: '/backups/postgres/' };
      const managerWithSlashes = new BackupManager(
        mockPostgresClient,
        mockS3Client,
        mockRetentionManager,
        configWithSlashes
      );

      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/test-backup.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date(),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue(
        's3://test-bucket/backups/postgres/test-backup.sql.gz'
      );
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });

      // Act
      await managerWithSlashes.executeBackup();

      // Assert
      expect(mockS3Client.uploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(
          /^backups\/postgres\/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/
        )
      );
    });
  });

  describe('cron validation', () => {
    const testCases = [
      { expression: '0 2 * * *', expected: true, description: 'valid daily at 2 AM' },
      { expression: '*/15 * * * *', expected: true, description: 'valid every 15 minutes' },
      { expression: '0 0 1 * *', expected: true, description: 'valid monthly on 1st' },
      { expression: '0 0 * * 0', expected: true, description: 'valid weekly on Sunday' },
      { expression: '0 0 1-5 * *', expected: true, description: 'valid range 1-5' },
      { expression: '0 0 * * 1,3,5', expected: true, description: 'valid list 1,3,5' },
      { expression: '0 0-23/2 * * *', expected: true, description: 'valid step with range' },
      { expression: 'invalid', expected: false, description: 'invalid single word' },
      { expression: '0 2 * *', expected: false, description: 'invalid missing field' },
      { expression: '0 2 * * * *', expected: false, description: 'invalid extra field' },
      { expression: '60 2 * * *', expected: false, description: 'invalid minute > 59' },
      { expression: '0 25 * * *', expected: false, description: 'invalid hour > 23' },
      { expression: '0 0 32 * *', expected: false, description: 'invalid day > 31' },
      { expression: '0 0 * 13 *', expected: false, description: 'invalid month > 12' },
      { expression: '0 0 * * 8', expected: false, description: 'invalid day of week > 7' },
    ];

    testCases.forEach(({ expression, expected, description }) => {
      it(`should ${expected ? 'accept' : 'reject'} ${description}: "${expression}"`, async () => {
        // Arrange
        const testConfig = { ...mockConfig, backupInterval: expression };
        const testManager = new BackupManager(
          mockPostgresClient,
          mockS3Client,
          mockRetentionManager,
          testConfig
        );

        mockPostgresClient.testConnection.mockResolvedValue(true);
        mockS3Client.testConnection.mockResolvedValue(true);

        // Act
        const result = await testManager.validateConfiguration();

        // Assert
        expect(result).toBe(expected);
      });
    });
  });

  describe('error handling and recovery', () => {
    beforeEach(() => {
      // Mock setTimeout for retry logic tests
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should retry PostgreSQL backup creation on transient failures', async () => {
      // Arrange
      const transientError = new Error('Connection timeout');
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-test.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date(),
      };

      mockPostgresClient.createBackup
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(mockBackupInfo);

      mockS3Client.uploadFile.mockResolvedValue('s3://test-bucket/backups/test.sql.gz');
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });

      // Act
      const backupPromise = backupManager.executeBackup();

      // Fast-forward through retry delays
      await jest.advanceTimersByTimeAsync(5000); // First retry delay
      await jest.advanceTimersByTimeAsync(10000); // Second retry delay

      const result = await backupPromise;

      // Assert
      expect(result.success).toBe(true);
      expect(mockPostgresClient.createBackup).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should not retry on non-retryable errors', async () => {
      // Arrange
      const authError = new Error('authentication failed');
      mockPostgresClient.createBackup.mockRejectedValue(authError);

      // Act
      const result = await backupManager.executeBackup();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('authentication failed');
      expect(mockPostgresClient.createBackup).toHaveBeenCalledTimes(1); // No retries
    });

    it('should fail after maximum retry attempts', async () => {
      // Arrange
      const persistentError = new Error('Network error');
      mockPostgresClient.createBackup.mockRejectedValue(persistentError);

      // Act
      const backupPromise = backupManager.executeBackup();

      // Fast-forward through all retry delays
      jest.advanceTimersByTime(5000); // First retry
      jest.advanceTimersByTime(10000); // Second retry

      const result = await backupPromise;

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to PostgreSQL backup creation after 2 attempts');
      expect(mockPostgresClient.createBackup).toHaveBeenCalledTimes(2); // Original + 1 retry (max 2 for DB operations)
    });

    it('should handle permission errors during temp file cleanup', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-test.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date(),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue('s3://test-bucket/backups/test.sql.gz');
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });

      const permissionError = new Error('Permission denied') as any;
      permissionError.code = 'EACCES';
      mockFs.unlink.mockRejectedValue(permissionError);

      // Act
      const result = await backupManager.executeBackup();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should generate unique operation IDs for tracking', async () => {
      // Arrange
      const mockBackupInfo: BackupInfo = {
        filePath: '/tmp/postgres-backup-test.sql.gz',
        fileSize: 1024000,
        databaseName: 'testdb',
        timestamp: new Date(),
      };

      mockPostgresClient.createBackup.mockResolvedValue(mockBackupInfo);
      mockS3Client.uploadFile.mockResolvedValue('s3://test-bucket/backups/test.sql.gz');
      mockRetentionManager.cleanupExpiredBackups.mockResolvedValue({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });

      // Act
      await backupManager.executeBackup();
      await backupManager.executeBackup();

      // Assert - Check that console.log was called with operation IDs
      const logCalls = (console.log as jest.Mock).mock.calls;
      const operationIdCalls = logCalls.filter(
        call =>
          call[0] && call[0].includes('[backup-') && call[0].includes('Starting backup operation')
      );

      expect(operationIdCalls.length).toBe(2);

      // Extract operation IDs and verify they're different
      const operationId1 = operationIdCalls[0][0].match(/\[([^\]]+)\]/)?.[1];
      const operationId2 = operationIdCalls[1][0].match(/\[([^\]]+)\]/)?.[1];

      expect(operationId1).toBeDefined();
      expect(operationId2).toBeDefined();
      expect(operationId1).not.toBe(operationId2);
    });

    it('should format errors consistently', async () => {
      // Arrange
      const customError = new ValidationError('Invalid configuration', 'testField');
      mockPostgresClient.createBackup.mockRejectedValue(customError);

      // Act
      const result = await backupManager.executeBackup();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('ValidationError: Invalid configuration');
    });

    it('should handle non-Error objects gracefully', async () => {
      // Arrange
      const stringError = 'Something went wrong';
      mockPostgresClient.createBackup.mockRejectedValue(stringError);

      // Act
      const result = await backupManager.executeBackup();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });

    it('should log stack traces for debugging', async () => {
      // Arrange
      const errorWithStack = new Error('Test error');
      errorWithStack.stack = 'Error: Test error\n    at test.js:1:1';
      mockPostgresClient.createBackup.mockRejectedValue(errorWithStack);

      // Act
      await backupManager.executeBackup();

      // Assert
      const errorCalls = (console.error as jest.Mock).mock.calls;
      const stackTraceCalls = errorCalls.filter(
        call => call[0] && call[0].includes('Stack trace:')
      );

      expect(stackTraceCalls.length).toBeGreaterThan(0);
    });
  });

  describe('custom error types', () => {
    it('should create BackupError with proper properties', () => {
      const cause = new Error('Original error');
      const backupError = new BackupError('Backup failed', 'test_operation', cause);

      expect(backupError.name).toBe('BackupError');
      expect(backupError.message).toBe('Backup failed');
      expect(backupError.operation).toBe('test_operation');
      expect(backupError.cause).toBe(cause);
      expect(backupError.stack).toContain('Caused by:');
    });

    it('should create ValidationError with proper properties', () => {
      const validationError = new ValidationError('Invalid field', 'testField');

      expect(validationError.name).toBe('ValidationError');
      expect(validationError.message).toBe('Invalid field');
      expect(validationError.field).toBe('testField');
    });

    it('should create RetryableError with proper properties', () => {
      const retryableError = new RetryableError('Operation failed', 'test_op', 3, 5);

      expect(retryableError.name).toBe('RetryableError');
      expect(retryableError.message).toBe('Operation failed');
      expect(retryableError.operation).toBe('test_op');
      expect(retryableError.attempt).toBe(3);
      expect(retryableError.maxAttempts).toBe(5);
    });
  });
});
