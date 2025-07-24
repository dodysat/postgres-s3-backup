import { RetentionManager } from '../src/clients/RetentionManager';
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