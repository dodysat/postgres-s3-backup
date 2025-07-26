import { S3Client } from '../S3Client';
import { BackupConfig } from '../../interfaces/BackupConfig';
import * as fs from 'fs';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('S3Client', () => {
  let s3Client: S3Client;
  let mockConfig: BackupConfig;
  let mockSend: jest.MockedFunction<any>;

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

    // Reset mocks before creating new instance
    jest.clearAllMocks();

    s3Client = new S3Client(mockConfig);

    // Get the mocked send function from the latest instance
    const { S3Client: MockedS3Client } = require('@aws-sdk/client-s3');
    const mockInstance =
      MockedS3Client.mock.results[MockedS3Client.mock.results.length - 1].value;
    mockSend = mockInstance.send;
  });

  describe('constructor', () => {
    it('should initialize S3 client with basic configuration', () => {
      const { S3Client: MockedS3Client } = require('@aws-sdk/client-s3');
      expect(MockedS3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      });
    });

    it('should initialize S3 client with custom endpoint when s3Url is provided', () => {
      const configWithUrl = {
        ...mockConfig,
        s3Url: 'http://localhost:9000',
      };

      new S3Client(configWithUrl);

      const { S3Client: MockedS3Client } = require('@aws-sdk/client-s3');
      expect(MockedS3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
      });
    });
  });

  describe('uploadFile', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('test data'));
      mockFs.statSync.mockReturnValue({
        size: 1024,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 0,
        ino: 0,
        mode: 0,
        nlink: 0,
        uid: 0,
        gid: 0,
        rdev: 0,
        blksize: 0,
        blocks: 0,
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
      } as fs.Stats);
    });

    it('should upload file successfully', async () => {
      const filePath = '/tmp/test-backup.sql.gz';
      const key = 'backups/test-backup.sql.gz';

      mockSend.mockResolvedValue({});

      const result = await s3Client.uploadFile(filePath, key);

      expect(result).toBe('s3://test-bucket/backups/test-backup.sql.gz');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should throw error when file does not exist', async () => {
      const filePath = '/tmp/nonexistent-file.sql.gz';
      const key = 'backups/test-backup.sql.gz';

      mockFs.existsSync.mockReturnValue(false);

      await expect(s3Client.uploadFile(filePath, key)).rejects.toThrow(
        'File not found: /tmp/nonexistent-file.sql.gz'
      );
    });

    it('should retry on retryable errors', async () => {
      const filePath = '/tmp/test-backup.sql.gz';
      const key = 'backups/test-backup.sql.gz';

      // Mock first attempt fails with retryable error, second succeeds
      mockSend
        .mockRejectedValueOnce(new Error('NetworkingError: Connection timeout'))
        .mockResolvedValueOnce({});

      const result = await s3Client.uploadFile(filePath, key);

      expect(result).toBe('s3://test-bucket/backups/test-backup.sql.gz');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const filePath = '/tmp/test-backup.sql.gz';
      const key = 'backups/test-backup.sql.gz';

      mockSend.mockRejectedValue(new Error('AccessDenied'));

      await expect(s3Client.uploadFile(filePath, key)).rejects.toThrow(
        'S3 upload failed: AccessDenied'
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('listObjects', () => {
    it('should list objects successfully', async () => {
      const prefix = 'backups/';
      const mockObjects = [
        {
          Key: 'backups/file1.sql.gz',
          LastModified: new Date('2023-01-01'),
          Size: 1024,
        },
        {
          Key: 'backups/file2.sql.gz',
          LastModified: new Date('2023-01-02'),
          Size: 2048,
        },
      ];

      mockSend.mockResolvedValue({
        Contents: mockObjects,
      });

      const result = await s3Client.listObjects(prefix);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        key: 'backups/file1.sql.gz',
        lastModified: new Date('2023-01-01'),
        size: 1024,
      });
      expect(result[1]).toEqual({
        key: 'backups/file2.sql.gz',
        lastModified: new Date('2023-01-02'),
        size: 2048,
      });
    });

    it('should return empty array when no objects found', async () => {
      const prefix = 'backups/';

      mockSend.mockResolvedValue({
        Contents: undefined,
      });

      const result = await s3Client.listObjects(prefix);

      expect(result).toEqual([]);
    });

    it('should handle list objects error', async () => {
      const prefix = 'backups/';

      mockSend.mockRejectedValue(new Error('Bucket not found'));

      await expect(s3Client.listObjects(prefix)).rejects.toThrow(
        'S3 list objects failed: Bucket not found'
      );
    });
  });

  describe('deleteObject', () => {
    it('should delete object successfully', async () => {
      const key = 'backups/old-backup.sql.gz';

      mockSend.mockResolvedValue({});

      await s3Client.deleteObject(key);

      expect(mockSend).toHaveBeenCalled();
    });

    it('should handle delete object error', async () => {
      const key = 'backups/old-backup.sql.gz';

      mockSend.mockRejectedValue(new Error('Object not found'));

      await expect(s3Client.deleteObject(key)).rejects.toThrow(
        'S3 delete object failed: Object not found'
      );
    });
  });

  describe('testConnection', () => {
    it('should return true when connection test succeeds', async () => {
      mockSend.mockResolvedValue({
        Contents: [],
      });

      const result = await s3Client.testConnection();

      expect(result).toBe(true);
    });

    it('should return false when connection test fails', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'));

      const result = await s3Client.testConnection();

      expect(result).toBe(false);
    });
  });
});
