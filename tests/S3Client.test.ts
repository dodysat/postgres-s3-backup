// Mock fs modules before any imports
jest.mock('fs', () => ({
  createReadStream: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
}));

// Mock AWS SDK
const mockSend = jest.fn();
const mockS3Client = {
  send: mockSend,
};

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  PutObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadBucketCommand: jest.fn(),
}));

import { S3Client } from '../src/clients/S3Client';
import { BackupConfig } from '../src/interfaces/BackupConfig';
import {
  S3Client as AWSS3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

const mockCreateReadStream = createReadStream as jest.MockedFunction<typeof createReadStream>;
const mockStat = stat as jest.MockedFunction<typeof stat>;

describe('S3Client', () => {
  let s3Client: S3Client;
  let mockConfig: BackupConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock AWS S3Client constructor
    (AWSS3Client as jest.MockedClass<typeof AWSS3Client>).mockImplementation(() => mockS3Client as any);

    mockConfig = {
      s3Bucket: 'test-bucket',
      s3Path: 'backups/',
      s3AccessKey: 'test-access-key',
      s3SecretKey: 'test-secret-key',
      postgresConnectionString: 'postgresql://test',
      backupInterval: '0 2 * * *',
    };

    s3Client = new S3Client(mockConfig);
  });

  describe('constructor', () => {
    it('should create S3Client with AWS credentials', () => {
      expect(AWSS3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      });
    });

    it('should configure custom endpoint when s3Url is provided', () => {
      const configWithUrl = {
        ...mockConfig,
        s3Url: 'http://localhost:9000',
      };

      new S3Client(configWithUrl);

      expect(AWSS3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
      });
    });
  });

  describe('uploadFile', () => {
    const mockFileStream = { pipe: jest.fn() } as any;

    beforeEach(() => {
      mockCreateReadStream.mockReturnValue(mockFileStream);
      mockStat.mockResolvedValue({ size: 1024 } as any);
      mockSend.mockResolvedValue({});
    });

    it('should upload file successfully', async () => {
      const result = await s3Client.uploadFile('/path/to/file.sql.gz', 'backup-2023-01-01.sql.gz');

      expect(mockStat).toHaveBeenCalledWith('/path/to/file.sql.gz');
      expect(mockCreateReadStream).toHaveBeenCalledWith('/path/to/file.sql.gz');
      expect(mockSend).toHaveBeenCalledWith(
        expect.any(PutObjectCommand)
      );
      expect(result).toBe('s3://test-bucket/backup-2023-01-01.sql.gz');
    });

    it('should set correct upload parameters', async () => {
      await s3Client.uploadFile('/path/to/file.sql.gz', 'backup-2023-01-01.sql.gz');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'backup-2023-01-01.sql.gz',
        Body: mockFileStream,
        ContentLength: 1024,
        ContentType: 'application/gzip',
        ContentEncoding: 'gzip',
      });
    });

    it('should retry on transient errors', async () => {
      const transientError = new Error('Network error');
      mockSend
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({});

      const result = await s3Client.uploadFile('/path/to/file.sql.gz', 'backup-2023-01-01.sql.gz');

      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(result).toBe('s3://test-bucket/backup-2023-01-01.sql.gz');
    });

    it('should not retry on non-retryable errors', async () => {
      const authError = new Error('Invalid access key');
      authError.name = 'InvalidAccessKeyId';
      mockSend.mockRejectedValue(authError);

      await expect(s3Client.uploadFile('/path/to/file.sql.gz', 'backup-2023-01-01.sql.gz'))
        .rejects.toThrow('Invalid access key');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries', async () => {
      const transientError = new Error('Network error');
      mockSend.mockRejectedValue(transientError);

      await expect(s3Client.uploadFile('/path/to/file.sql.gz', 'backup-2023-01-01.sql.gz'))
        .rejects.toThrow('Failed to upload file /path/to/file.sql.gz to backup-2023-01-01.sql.gz after 3 attempts');

      expect(mockSend).toHaveBeenCalledTimes(3);
    });
  });

  describe('listObjects', () => {
    it('should list objects with prefix', async () => {
      const mockResponse = {
        Contents: [
          {
            Key: 'backups/backup-2023-01-01.sql.gz',
            LastModified: new Date('2023-01-01T10:00:00Z'),
            Size: 1024,
          },
          {
            Key: 'backups/backup-2023-01-02.sql.gz',
            LastModified: new Date('2023-01-02T10:00:00Z'),
            Size: 2048,
          },
        ],
      };
      mockSend.mockResolvedValue(mockResponse);

      const result = await s3Client.listObjects('backups/');

      expect(mockSend).toHaveBeenCalledWith(
        expect.any(ListObjectsV2Command)
      );
      expect(result).toEqual([
        {
          key: 'backups/backup-2023-01-01.sql.gz',
          lastModified: new Date('2023-01-01T10:00:00Z'),
          size: 1024,
        },
        {
          key: 'backups/backup-2023-01-02.sql.gz',
          lastModified: new Date('2023-01-02T10:00:00Z'),
          size: 2048,
        },
      ]);
    });

    it('should return empty array when no objects found', async () => {
      const mockResponse = { Contents: undefined };
      mockSend.mockResolvedValue(mockResponse);

      const result = await s3Client.listObjects('backups/');

      expect(result).toEqual([]);
    });

    it('should handle objects with missing size', async () => {
      const mockResponse = {
        Contents: [
          {
            Key: 'backups/backup-2023-01-01.sql.gz',
            LastModified: new Date('2023-01-01T10:00:00Z'),
            Size: undefined,
          },
        ],
      };
      mockSend.mockResolvedValue(mockResponse);

      const result = await s3Client.listObjects('backups/');

      expect(result[0].size).toBe(0);
    });

    it('should retry on transient errors', async () => {
      const transientError = new Error('Network error');
      mockSend
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({ Contents: [] });

      const result = await s3Client.listObjects('backups/');

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toEqual([]);
    });
  });

  describe('deleteObject', () => {
    it('should delete object successfully', async () => {
      mockSend.mockResolvedValue({});

      await s3Client.deleteObject('backups/backup-2023-01-01.sql.gz');

      expect(mockSend).toHaveBeenCalledWith(
        expect.any(DeleteObjectCommand)
      );

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'backups/backup-2023-01-01.sql.gz',
      });
    });

    it('should retry on transient errors', async () => {
      const transientError = new Error('Network error');
      mockSend
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({});

      await s3Client.deleteObject('backups/backup-2023-01-01.sql.gz');

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should not retry on permission errors', async () => {
      const permissionError = new Error('Access denied');
      permissionError.name = 'AccessDenied';
      mockSend.mockRejectedValue(permissionError);

      await expect(s3Client.deleteObject('backups/backup-2023-01-01.sql.gz'))
        .rejects.toThrow('Access denied');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockSend.mockResolvedValue({});

      const result = await s3Client.testConnection();

      expect(mockSend).toHaveBeenCalledWith(
        expect.any(HeadBucketCommand)
      );
      expect(result).toBe(true);
    });

    it('should return false when connection fails', async () => {
      const error = new Error('Connection failed');
      mockSend.mockRejectedValue(error);

      // Mock console.error to avoid test output noise
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await s3Client.testConnection();

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('S3 connection test failed:', error);

      consoleSpy.mockRestore();
    });

    it('should use correct bucket in HeadBucketCommand', async () => {
      mockSend.mockResolvedValue({});

      await s3Client.testConnection();

      expect(HeadBucketCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
      });
    });
  });

  describe('retry logic', () => {
    it('should implement exponential backoff', async () => {
      const transientError = new Error('Network error');
      mockSend
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({});

      // Mock setTimeout to track delays
      const originalSetTimeout = setTimeout;
      const delays: number[] = [];
      global.setTimeout = jest.fn((callback, delay) => {
        delays.push(delay);
        return originalSetTimeout(callback, 0); // Execute immediately for tests
      }) as any;

      await s3Client.deleteObject('test-key');

      expect(delays).toEqual([1000, 2000]); // 1s, 2s exponential backoff

      global.setTimeout = originalSetTimeout;
    });

    it('should identify non-retryable HTTP status codes', async () => {
      const clientError = new Error('Client error');
      (clientError as any).$metadata = { httpStatusCode: 403 };
      mockSend.mockRejectedValue(clientError);

      await expect(s3Client.deleteObject('test-key'))
        .rejects.toThrow('Client error');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});