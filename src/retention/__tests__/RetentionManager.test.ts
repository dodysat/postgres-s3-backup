import { RetentionManager } from '../RetentionManager';
import { S3Client } from '../../s3/S3Client';
import { BackupConfig } from '../../interfaces/BackupConfig';
import { S3Object } from '../../interfaces/S3Client';

// Mock S3Client
jest.mock('../../s3/S3Client');
const MockedS3Client = S3Client as jest.MockedClass<typeof S3Client>;

describe('RetentionManager', () => {
  let retentionManager: RetentionManager;
  let mockS3Client: jest.Mocked<S3Client>;
  let mockConfig: BackupConfig;

  beforeEach(() => {
    mockConfig = {
      s3Bucket: 'test-bucket',
      s3Path: 'backups',
      s3AccessKey: 'test-key',
      s3SecretKey: 'test-secret',
      postgresConnectionString: 'postgresql://user:pass@localhost:5432/testdb',
      backupInterval: '0 2 * * *',
      retentionDays: 30,
      logLevel: 'info',
    };

    mockS3Client = {
      uploadFile: jest.fn(),
      listObjects: jest.fn(),
      deleteObject: jest.fn(),
      testConnection: jest.fn(),
    } as unknown as jest.Mocked<S3Client>;

    MockedS3Client.mockImplementation(() => mockS3Client);

    retentionManager = new RetentionManager(mockS3Client, mockConfig);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('cleanupExpiredBackups', () => {
    it('should skip cleanup when no retention period is configured', async () => {
      const { retentionDays, ...configWithoutRetention } = mockConfig;
      retentionManager = new RetentionManager(
        mockS3Client,
        configWithoutRetention
      );

      const result = await retentionManager.cleanupExpiredBackups();

      expect(result).toBe(0);
      expect(mockS3Client.listObjects).not.toHaveBeenCalled();
    });

    it('should cleanup expired backups successfully', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-01-01_12-00-00.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-12-01_12-00-00.sql.gz',
          lastModified: new Date('2023-12-01'),
          size: 2048,
        },
        {
          key: 'backups/other-file.txt',
          lastModified: new Date('2023-01-01'),
          size: 512,
        },
      ];

      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject.mockResolvedValue();

      const result = await retentionManager.cleanupExpiredBackups();

      expect(result).toBe(2); // Both backups from 2023 are expired in 2025
      expect(mockS3Client.listObjects).toHaveBeenCalledWith('backups');
      expect(mockS3Client.deleteObject).toHaveBeenCalledWith(
        'backups/postgres-backup-2023-01-01_12-00-00.sql.gz'
      );
      expect(mockS3Client.deleteObject).toHaveBeenCalledWith(
        'backups/postgres-backup-2023-12-01_12-00-00.sql.gz'
      );
    });

    it('should handle empty object list', async () => {
      mockS3Client.listObjects.mockResolvedValue([]);

      const result = await retentionManager.cleanupExpiredBackups();

      expect(result).toBe(0);
      expect(mockS3Client.listObjects).toHaveBeenCalledWith('backups');
      expect(mockS3Client.deleteObject).not.toHaveBeenCalled();
    });

    it('should continue cleanup even if individual deletions fail', async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-01-01_12-00-00.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-01-02_12-00-00.sql.gz',
          lastModified: new Date('2023-01-02'),
          size: 2048,
        },
      ];

      mockS3Client.listObjects.mockResolvedValue(mockObjects);
      mockS3Client.deleteObject
        .mockRejectedValueOnce(new Error('Delete failed'))
        .mockResolvedValueOnce();

      const result = await retentionManager.cleanupExpiredBackups();

      expect(result).toBe(1);
      expect(mockS3Client.deleteObject).toHaveBeenCalledTimes(2);
    });

    it('should handle list objects error', async () => {
      mockS3Client.listObjects.mockRejectedValue(new Error('S3 error'));

      await expect(retentionManager.cleanupExpiredBackups()).rejects.toThrow(
        'Retention cleanup failed: S3 error'
      );
    });
  });

  describe('getBackupStats', () => {
    it('should return zero stats when no objects found', async () => {
      mockS3Client.listObjects.mockResolvedValue([]);

      const stats = await retentionManager.getBackupStats();

      expect(stats).toEqual({
        totalBackups: 0,
        expiredBackups: 0,
        totalSize: 0,
        expiredSize: 0,
      });
    });

    it('should calculate stats correctly with retention period', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-01-01_12-00-00.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-12-01_12-00-00.sql.gz',
          lastModified: new Date('2023-12-01'),
          size: 2048,
        },
        {
          key: 'backups/other-file.txt',
          lastModified: new Date('2023-01-01'),
          size: 512,
        },
      ];

      mockS3Client.listObjects.mockResolvedValue(mockObjects);

      const stats = await retentionManager.getBackupStats();

      expect(stats).toEqual({
        totalBackups: 2,
        expiredBackups: 2, // Both backups from 2023 are expired in 2025
        totalSize: 3072, // 1024 + 2048
        expiredSize: 3072, // Both backups are expired
      });
    });

    it('should handle case when no retention period is configured', async () => {
      const { retentionDays, ...configWithoutRetention } = mockConfig;
      retentionManager = new RetentionManager(
        mockS3Client,
        configWithoutRetention
      );

      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-01-01_12-00-00.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1024,
        },
      ];

      mockS3Client.listObjects.mockResolvedValue(mockObjects);

      const stats = await retentionManager.getBackupStats();

      expect(stats).toEqual({
        totalBackups: 1,
        expiredBackups: 0,
        totalSize: 1024,
        expiredSize: 0,
      });
    });

    it('should handle getBackupStats error', async () => {
      mockS3Client.listObjects.mockRejectedValue(new Error('S3 error'));

      await expect(retentionManager.getBackupStats()).rejects.toThrow(
        'Failed to get backup stats: S3 error'
      );
    });
  });

  describe('listExpiredBackups', () => {
    it('should return empty array when no retention period is configured', async () => {
      const { retentionDays, ...configWithoutRetention } = mockConfig;
      retentionManager = new RetentionManager(
        mockS3Client,
        configWithoutRetention
      );

      const result = await retentionManager.listExpiredBackups();

      expect(result).toEqual([]);
      expect(mockS3Client.listObjects).not.toHaveBeenCalled();
    });

    it('should return expired backups list', async () => {
      const mockObjects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-01-01_12-00-00.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-12-01_12-00-00.sql.gz',
          lastModified: new Date('2023-12-01'),
          size: 2048,
        },
      ];

      mockS3Client.listObjects.mockResolvedValue(mockObjects);

      const result = await retentionManager.listExpiredBackups();

      expect(result).toHaveLength(2); // Both backups from 2023 are expired in 2025
      expect(result[0]?.key).toBe(
        'backups/postgres-backup-2023-01-01_12-00-00.sql.gz'
      );
      expect(result[1]?.key).toBe(
        'backups/postgres-backup-2023-12-01_12-00-00.sql.gz'
      );
    });

    it('should handle listExpiredBackups error', async () => {
      mockS3Client.listObjects.mockRejectedValue(new Error('S3 error'));

      await expect(retentionManager.listExpiredBackups()).rejects.toThrow(
        'Failed to list expired backups: S3 error'
      );
    });
  });

  describe('validateRetentionConfiguration', () => {
    it('should return true when validation succeeds', async () => {
      mockS3Client.testConnection.mockResolvedValue(true);
      mockS3Client.listObjects.mockResolvedValue([]);

      const result = await retentionManager.validateRetentionConfiguration();

      expect(result).toBe(true);
      expect(mockS3Client.testConnection).toHaveBeenCalled();
      expect(mockS3Client.listObjects).toHaveBeenCalledWith('backups');
    });

    it('should return false when S3 connection fails', async () => {
      mockS3Client.testConnection.mockResolvedValue(false);

      const result = await retentionManager.validateRetentionConfiguration();

      expect(result).toBe(false);
      expect(mockS3Client.testConnection).toHaveBeenCalled();
      expect(mockS3Client.listObjects).not.toHaveBeenCalled();
    });

    it('should return false when list objects fails', async () => {
      mockS3Client.testConnection.mockResolvedValue(true);
      mockS3Client.listObjects.mockRejectedValue(new Error('S3 error'));

      const result = await retentionManager.validateRetentionConfiguration();

      expect(result).toBe(false);
    });
  });

  describe('filterExpiredBackups', () => {
    it('should filter backups correctly', () => {
      const cutoffDate = new Date('2023-06-01');

      const objects: S3Object[] = [
        {
          key: 'backups/postgres-backup-2023-01-01_12-00-00.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-12-01_12-00-00.sql.gz',
          lastModified: new Date('2023-12-01'),
          size: 2048,
        },
        {
          key: 'backups/other-file.txt',
          lastModified: new Date('2023-01-01'),
          size: 512,
        },
        {
          key: 'backups/postgres-backup-2023-05-01_12-00-00.sql.gz',
          lastModified: new Date('2023-05-01'),
          size: 1536,
        },
      ];

      // Access private method through any
      const result = (retentionManager as any).filterExpiredBackups(
        objects,
        cutoffDate
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.key).toBe(
        'backups/postgres-backup-2023-01-01_12-00-00.sql.gz'
      );
      expect(result[1]?.key).toBe(
        'backups/postgres-backup-2023-05-01_12-00-00.sql.gz'
      );
    });

    it('should only match backup naming pattern', () => {
      const cutoffDate = new Date('2023-06-01');

      const objects: S3Object[] = [
        {
          key: 'backups/not-a-backup.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1024,
        },
        {
          key: 'backups/postgres-backup-2023-01-01_12-00-00.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 2048,
        },
        {
          key: 'backups/backup-2023-01-01.sql.gz',
          lastModified: new Date('2023-01-01'),
          size: 1536,
        },
      ];

      const result = (retentionManager as any).filterExpiredBackups(
        objects,
        cutoffDate
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.key).toBe(
        'backups/postgres-backup-2023-01-01_12-00-00.sql.gz'
      );
    });
  });
});
