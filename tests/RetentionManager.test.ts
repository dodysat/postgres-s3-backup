import { RetentionManager, RetentionError, RetentionListingError, RetentionDeletionError } from '../src/clients/RetentionManager';
import { S3Client } from '../src/interfaces/S3Client';
import { BackupConfig } from '../src/interfaces/BackupConfig';
import { S3Object } from '../src/interfaces/S3Client';

// Mock console methods to avoid test output noise
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

describe('RetentionManager', () => {
  let retentionManager: RetentionManager;
  let mockS3Client: jest.Mocked<S3Client>;
  let mockConfig: BackupConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock S3Client
    mockS3Client = {
      uploadFile: jest.fn(),
      listObjects: jest.fn(),
      deleteObject: jest.fn(),
      testConnection: jest.fn(),
    };

    mockConfig = {
      s3Bucket: 'test-bucket',
      s3Path: 'backups/',
      s3AccessKey: 'test-access-key',
      s3SecretKey: 'test-secret-key',
      postgresConnectionString: 'postgresql://test',
      backupInterval: '0 2 * * *',
      retentionDays: 7, // 7 days retention
    };

    retentionManager = new RetentionManager(mockS3Client, mockConfig);
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleWarn.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with S3Client and config', () => {
      expect(retentionManager).toBeInstanceOf(RetentionManager);
    });

    it('should handle config without retention days', () => {
      const configWithoutRetention = { ...mockConfig };
      delete configWithoutRetention.retentionDays;
      
      const manager = new RetentionManager(mockS3Client, configWithoutRetention);
      expect(manager).toBeInstanceOf(RetentionManager);
    });
  });

  describe('extractTimestampFromKey', () => {
    it('should extract timestamp from valid backup filename', () => {
      const key = 'backups/postgres-backup-2023-12-15_14-30-45.sql.gz';
      const result = retentionManager.extractTimestampFromKey(key);
      
      expect(result).toEqual(new Date('2023-12-15T14:30:45'));
    });

    it('should extract timestamp from filename without path prefix', () => {
      const key = 'postgres-backup-2023-12-15_14-30-45.sql.gz';
      const result = retentionManager.extractTimestampFromKey(key);
      
      expect(result).toEqual(new Date('2023-12-15T14:30:45'));
    });

    it('should return null for invalid filename format', () => {
      const key = 'invalid-backup-name.sql.gz';
      const result = retentionManager.extractTimestampFromKey(key);
      
      expect(result).toBeNull();
    });

    it('should return null for malformed timestamp', () => {
      const key = 'postgres-backup-invalid-timestamp.sql.gz';
      const result = retentionManager.extractTimestampFromKey(key);
      
      expect(result).toBeNull();
    });

    it('should handle edge case timestamps', () => {
      const key = 'postgres-backup-2023-02-28_23-59-59.sql.gz';
      const result = retentionManager.extractTimestampFromKey(key);
      
      expect(result).toEqual(new Date('2023-02-28T23:59:59'));
    });

    it('should log warning for extraction errors', () => {
      const key = 'postgres-backup-2023-13-45_25-70-80.sql.gz'; // Invalid date
      const result = retentionManager.extractTimestampFromKey(key);
      
      expect(result).toBeNull();
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to extract timestamp from backup key')
      );
    });
  });

  describe('isBackupExpired', () => {
    const now = new Date('2023-12-20T10:00:00Z');
    
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(now);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return false when no retention policy is set', () => {
      const configWithoutRetention = { ...mockConfig };
      delete configWithoutRetention.retentionDays;
      const manager = new RetentionManager(mockS3Client, configWithoutRetention);
      
      const oldDate = new Date('2020-01-01T10:00:00Z');
      const result = manager.isBackupExpired('any-key', oldDate);
      
      expect(result).toBe(false);
    });

    it('should return true for backup older than retention period', () => {
      const oldDate = new Date('2023-12-10T10:00:00Z'); // 10 days ago
      const result = retentionManager.isBackupExpired('old-backup.sql.gz', oldDate);
      
      expect(result).toBe(true);
    });

    it('should return false for backup within retention period', () => {
      const recentDate = new Date('2023-12-18T10:00:00Z'); // 2 days ago
      const result = retentionManager.isBackupExpired('recent-backup.sql.gz', recentDate);
      
      expect(result).toBe(false);
    });

    it('should use filename timestamp when available', () => {
      const key = 'postgres-backup-2023-12-10_10-00-00.sql.gz'; // 10 days ago in filename
      const recentLastModified = new Date('2023-12-19T10:00:00Z'); // 1 day ago in lastModified
      
      const result = retentionManager.isBackupExpired(key, recentLastModified);
      
      // Should use filename timestamp (10 days ago) and return true
      expect(result).toBe(true);
    });

    it('should fall back to lastModified when filename timestamp is invalid', () => {
      const key = 'invalid-backup-name.sql.gz';
      const recentLastModified = new Date('2023-12-18T10:00:00Z'); // 2 days ago
      
      const result = retentionManager.isBackupExpired(key, recentLastModified);
      
      // Should use lastModified (2 days ago) and return false
      expect(result).toBe(false);
    });

    it('should handle exact retention boundary', () => {
      const exactBoundaryDate = new Date('2023-12-13T10:00:00Z'); // Exactly 7 days ago
      const result = retentionManager.isBackupExpired('boundary-backup.sql.gz', exactBoundaryDate);
      
      expect(result).toBe(false); // Should not be expired at exact boundary
    });

    it('should handle retention boundary plus one day', () => {
      const pastBoundaryDate = new Date('2023-12-13T09:59:59Z'); // Just over 7 days ago
      const result = retentionManager.isBackupExpired('past-boundary-backup.sql.gz', pastBoundaryDate);
      
      expect(result).toBe(true); // Should be expired
    });
  });

  describe('cleanupExpiredBackups', () => {
    const now = new Date('2023-12-20T10:00:00Z');
    
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(now);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should skip cleanup when no retention policy is configured', async () => {
      const configWithoutRetention = { ...mockConfig };
      delete configWithoutRetention.retentionDays;
      const manager = new RetentionManager(mockS3Client, configWithoutRetention);
      
      const result = await manager.cleanupExpiredBackups('backups/');
      
      expect(result).toEqual({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });
      expect(mockS3Client.listObjects).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith('No retention policy configured, keeping all backups');
    });

    it('should handle empty backup list', async () => {
      mockS3Client.listObjects.mockResolvedValue([]);
      
      const result = await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(result).toEqual({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: [],
      });
      expect(mockConsoleLog).toHaveBeenCalledWith('No backups found with prefix: backups/');
    });

    it('should delete expired backups and keep recent ones', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz', // 10 days ago - expired
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-12-18_10-00-00.sql.gz', // 2 days ago - not expired
          lastModified: new Date('2023-12-18T10:00:00Z'),
          size: 2048,
        },
        {
          key: 'backups/postgres-backup-2023-12-05_10-00-00.sql.gz', // 15 days ago - expired
          lastModified: new Date('2023-12-05T10:00:00Z'),
          size: 1536,
        },
      ];
      
      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject.mockResolvedValue();
      
      const result = await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(result).toEqual({
        deletedCount: 2,
        totalCount: 3,
        deletedKeys: [
          'backups/postgres-backup-2023-12-10_10-00-00.sql.gz',
          'backups/postgres-backup-2023-12-05_10-00-00.sql.gz',
        ],
        errors: [],
      });
      
      expect(mockS3Client.deleteObject).toHaveBeenCalledTimes(2);
      expect(mockS3Client.deleteObject).toHaveBeenCalledWith('backups/postgres-backup-2023-12-10_10-00-00.sql.gz');
      expect(mockS3Client.deleteObject).toHaveBeenCalledWith('backups/postgres-backup-2023-12-05_10-00-00.sql.gz');
    });

    it('should handle deletion errors gracefully', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz', // expired
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-12-05_10-00-00.sql.gz', // expired
          lastModified: new Date('2023-12-05T10:00:00Z'),
          size: 1536,
        },
      ];
      
      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject
        .mockResolvedValueOnce() // First deletion succeeds
        .mockRejectedValueOnce(new Error('Access denied')); // Second deletion fails
      
      const result = await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(result).toEqual({
        deletedCount: 1,
        totalCount: 2,
        deletedKeys: ['backups/postgres-backup-2023-12-10_10-00-00.sql.gz'],
        errors: ['Failed to delete backup backups/postgres-backup-2023-12-05_10-00-00.sql.gz: Access denied'],
      });
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Failed to delete backup backups/postgres-backup-2023-12-05_10-00-00.sql.gz: Access denied'
      );
    });

    it('should handle S3 listing errors', async () => {
      mockS3Client.listObjects.mockRejectedValue(new Error('Network error'));
      
      const result = await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(result).toEqual({
        deletedCount: 0,
        totalCount: 0,
        deletedKeys: [],
        errors: ['Failed to list backups for cleanup: Network error'],
      });
      
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to list backups for cleanup: Network error');
    });

    it('should log cleanup progress', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz',
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
      ];
      
      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject.mockResolvedValue();
      
      await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(mockConsoleLog).toHaveBeenCalledWith('Found 1 backup files, checking for expired backups...');
      expect(mockConsoleLog).toHaveBeenCalledWith('Deleted expired backup: backups/postgres-backup-2023-12-10_10-00-00.sql.gz');
      expect(mockConsoleLog).toHaveBeenCalledWith('Retention cleanup completed: 1 backups deleted out of 1 total');
    });

    it('should handle mixed filename formats correctly', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz', // Valid format, expired
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
        {
          key: 'backups/manual-backup-old.sql.gz', // Invalid format, use lastModified (expired)
          lastModified: new Date('2023-12-05T10:00:00Z'),
          size: 2048,
        },
        {
          key: 'backups/manual-backup-recent.sql.gz', // Invalid format, use lastModified (not expired)
          lastModified: new Date('2023-12-18T10:00:00Z'),
          size: 1536,
        },
      ];
      
      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject.mockResolvedValue();
      
      const result = await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(result.deletedCount).toBe(2);
      expect(result.totalCount).toBe(3);
      expect(result.deletedKeys).toContain('backups/postgres-backup-2023-12-10_10-00-00.sql.gz');
      expect(result.deletedKeys).toContain('backups/manual-backup-old.sql.gz');
      expect(result.deletedKeys).not.toContain('backups/manual-backup-recent.sql.gz');
    });
  });

  describe('enhanced error handling and recovery', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should retry S3 listing operations on transient failures', async () => {
      const transientError = new Error('Network timeout');
      mockS3Client.listObjects
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce([]);

      const cleanupPromise = retentionManager.cleanupExpiredBackups('backups/');
      
      // Fast-forward through retry delays
      jest.advanceTimersByTime(1000); // First retry
      jest.advanceTimersByTime(2000); // Second retry
      
      const result = await cleanupPromise;

      expect(result.totalCount).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockS3Client.listObjects).toHaveBeenCalledTimes(3);
    });

    it('should retry individual deletion operations on transient failures', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz',
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
      ];

      const transientError = new Error('Temporary S3 error');
      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce();

      const cleanupPromise = retentionManager.cleanupExpiredBackups('backups/');
      
      // Fast-forward through retry delay
      jest.advanceTimersByTime(1000);
      
      const result = await cleanupPromise;

      expect(result.deletedCount).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockS3Client.deleteObject).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const authError = new Error('Access denied');
      authError.name = 'AccessDenied';
      
      mockS3Client.listObjects.mockRejectedValue(authError);

      const result = await retentionManager.cleanupExpiredBackups('backups/');

      expect(result.errors).toContain('Failed to list backups for cleanup: Error: Access denied');
      expect(mockS3Client.listObjects).toHaveBeenCalledTimes(1); // No retries
    });

    it('should handle HTTP 4xx errors as non-retryable', async () => {
      const clientError = new Error('Client error') as any;
      clientError.$metadata = { httpStatusCode: 403 };
      
      mockS3Client.listObjects.mockRejectedValue(clientError);

      const result = await retentionManager.cleanupExpiredBackups('backups/');

      expect(result.errors).toContain('Failed to list backups for cleanup: Error: Client error');
      expect(mockS3Client.listObjects).toHaveBeenCalledTimes(1); // No retries
    });

    it('should fail after maximum retry attempts', async () => {
      const persistentError = new Error('Persistent network error');
      mockS3Client.listObjects.mockRejectedValue(persistentError);

      const cleanupPromise = retentionManager.cleanupExpiredBackups('backups/');
      
      // Fast-forward through all retry delays
      jest.advanceTimersByTime(1000); // First retry
      jest.advanceTimersByTime(2000); // Second retry
      jest.advanceTimersByTime(4000); // Third retry
      
      const result = await cleanupPromise;

      expect(result.errors).toContain('Failed to list backups for cleanup after 3 attempts');
      expect(mockS3Client.listObjects).toHaveBeenCalledTimes(3);
    });

    it('should log retry attempts with exponential backoff', async () => {
      const transientError = new Error('Network error');
      mockS3Client.listObjects
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce([]);

      const cleanupPromise = retentionManager.cleanupExpiredBackups('backups/');
      
      // Fast-forward through retry delays
      jest.advanceTimersByTime(1000); // First retry (1s delay)
      jest.advanceTimersByTime(2000); // Second retry (2s delay)
      
      await cleanupPromise;

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Attempt 1 failed for list S3 objects for retention cleanup: Error: Network error. Retrying in 1000ms...')
      );
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Attempt 2 failed for list S3 objects for retention cleanup: Error: Network error. Retrying in 2000ms...')
      );
    });

    it('should log detailed error context for deletion failures', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz',
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
      ];

      const deletionError = new Error('Permission denied');
      deletionError.name = 'AccessDenied';
      
      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject.mockRejectedValue(deletionError);

      await retentionManager.cleanupExpiredBackups('backups/');

      expect(mockConsoleError).toHaveBeenCalledWith('Deletion error context:', {
        key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz',
        lastModified: '2023-12-10T10:00:00.000Z',
        size: 1024,
        errorType: 'AccessDenied'
      });
    });

    it('should calculate and log success rate', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/backup1.sql.gz',
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
        {
          key: 'backups/backup2.sql.gz',
          lastModified: new Date('2023-12-09T10:00:00Z'),
          size: 1024,
        },
        {
          key: 'backups/backup3.sql.gz',
          lastModified: new Date('2023-12-08T10:00:00Z'),
          size: 1024,
        },
      ];

      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject
        .mockResolvedValueOnce() // First succeeds
        .mockRejectedValueOnce(new Error('Failed')) // Second fails
        .mockResolvedValueOnce(); // Third succeeds

      await retentionManager.cleanupExpiredBackups('backups/');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('(66.7% success rate)')
      );
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'Retention cleanup had 1 errors. Some backups may not have been deleted.'
      );
    });

    it('should handle unexpected errors during cleanup', async () => {
      // Mock an unexpected error that occurs outside the main try-catch
      const unexpectedError = new Error('Unexpected system error');
      mockS3Client.listObjects.mockImplementation(() => {
        throw unexpectedError; // Synchronous throw instead of rejection
      });

      const result = await retentionManager.cleanupExpiredBackups('backups/');

      expect(result.errors).toContain('Unexpected error during retention cleanup: Error: Unexpected system error');
      expect(mockConsoleError).toHaveBeenCalledWith('Retention cleanup stack trace:', expect.any(String));
    });

    it('should handle non-Error objects in retry logic', async () => {
      mockS3Client.listObjects.mockRejectedValue('String error');

      const result = await retentionManager.cleanupExpiredBackups('backups/');

      expect(result.errors).toContain('Failed to list backups for cleanup: String error');
    });
  });

  describe('custom error types', () => {
    it('should create RetentionError with proper properties', () => {
      const cause = new Error('Original error');
      const retentionError = new RetentionError('Retention failed', 'test_operation', cause);

      expect(retentionError.name).toBe('RetentionError');
      expect(retentionError.message).toBe('Retention failed');
      expect(retentionError.operation).toBe('test_operation');
      expect(retentionError.cause).toBe(cause);
      expect(retentionError.stack).toContain('Caused by:');
    });

    it('should create RetentionListingError with proper properties', () => {
      const cause = new Error('Listing failed');
      const listingError = new RetentionListingError('Cannot list objects', cause);

      expect(listingError.name).toBe('RetentionListingError');
      expect(listingError.message).toBe('Cannot list objects');
      expect(listingError.operation).toBe('listing');
      expect(listingError.cause).toBe(cause);
    });

    it('should create RetentionDeletionError with proper properties', () => {
      const cause = new Error('Deletion failed');
      const deletionError = new RetentionDeletionError('Cannot delete object', 'test-key', cause);

      expect(deletionError.name).toBe('RetentionDeletionError');
      expect(deletionError.message).toBe('Cannot delete object');
      expect(deletionError.operation).toBe('deletion');
      expect(deletionError.key).toBe('test-key');
      expect(deletionError.cause).toBe(cause);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle non-Error objects in catch blocks', async () => {
      mockS3Client.listObjects.mockRejectedValue('String error');
      
      const result = await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(result.errors).toContain('Failed to list backups for cleanup: String error');
    });

    it('should handle deletion with non-Error objects', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-12-10_10-00-00.sql.gz',
          lastModified: new Date('2023-12-10T10:00:00Z'),
          size: 1024,
        },
      ];
      
      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject.mockRejectedValue('String deletion error');
      
      const result = await retentionManager.cleanupExpiredBackups('backups/');
      
      expect(result.errors).toContain('Failed to delete backup backups/postgres-backup-2023-12-10_10-00-00.sql.gz: String deletion error');
    });

    it('should handle very large retention periods', () => {
      const configWithLargeRetention = { ...mockConfig, retentionDays: 36500 }; // 100 years
      const manager = new RetentionManager(mockS3Client, configWithLargeRetention);
      
      const veryOldDate = new Date('1900-01-01T10:00:00Z');
      const result = manager.isBackupExpired('old-backup.sql.gz', veryOldDate);
      
      expect(result).toBe(true);
    });

    it('should handle zero retention period', () => {
      const configWithZeroRetention = { ...mockConfig, retentionDays: 0 };
      const manager = new RetentionManager(mockS3Client, configWithZeroRetention);
      
      const recentDate = new Date();
      const result = manager.isBackupExpired('recent-backup.sql.gz', recentDate);
      
      expect(result).toBe(true); // Everything should be expired with 0 day retention
    });
  });
});