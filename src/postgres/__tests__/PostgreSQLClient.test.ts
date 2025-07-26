import { PostgreSQLClient } from '../PostgreSQLClient';
import { BackupConfig } from '../../interfaces/BackupConfig';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PostgreSQLClient', () => {
  let postgresClient: PostgreSQLClient;
  let mockConfig: BackupConfig;

  beforeEach(() => {
    mockConfig = {
      s3Bucket: 'test-bucket',
      s3Path: 'backups',
      s3AccessKey: 'test-key',
      s3SecretKey: 'test-secret',
      postgresConnectionString: 'postgresql://user:pass@localhost:5432/testdb',
      backupInterval: '0 2 * * *',
      logLevel: 'info',
    };

    postgresClient = new PostgreSQLClient(mockConfig);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('extractDatabaseName', () => {
    it('should extract database name from standard connection string', () => {
      const client = new PostgreSQLClient({
        ...mockConfig,
        postgresConnectionString: 'postgresql://user:pass@localhost:5432/mydb',
      });

      // Access private method through any
      const result = (client as any).extractDatabaseName(
        'postgresql://user:pass@localhost:5432/mydb'
      );
      expect(result).toBe('mydb');
    });

    it('should extract database name from connection string with query params', () => {
      const client = new PostgreSQLClient({
        ...mockConfig,
        postgresConnectionString:
          'postgresql://user:pass@localhost:5432/mydb?sslmode=require',
      });

      const result = (client as any).extractDatabaseName(
        'postgresql://user:pass@localhost:5432/mydb?sslmode=require'
      );
      expect(result).toBe('mydb');
    });

    it('should throw error for invalid connection string', () => {
      const client = new PostgreSQLClient(mockConfig);

      expect(() => {
        (client as any).extractDatabaseName('invalid-connection-string');
      }).toThrow('Could not extract database name from connection string');
    });
  });

  describe('cleanupBackupFile', () => {
    it('should delete backup file when it exists', async () => {
      const filePath = '/tmp/test-backup.sql.gz';
      mockFs.existsSync.mockReturnValue(true);

      await postgresClient.cleanupBackupFile(filePath);

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(filePath);
    });

    it('should not throw error when file does not exist', async () => {
      const filePath = '/tmp/test-backup.sql.gz';
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        postgresClient.cleanupBackupFile(filePath)
      ).resolves.not.toThrow();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should handle unlink errors gracefully', async () => {
      const filePath = '/tmp/test-backup.sql.gz';
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(
        postgresClient.cleanupBackupFile(filePath)
      ).resolves.not.toThrow();
    });
  });

  // Note: The testConnection and createBackup methods require actual pg_dump execution
  // and are better tested in integration tests with a real PostgreSQL instance
  // or with more complex mocking of the child_process module
});
