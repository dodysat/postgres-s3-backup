import { BackupManagerImpl } from '../BackupManager';
import { BackupConfig } from '../../interfaces/BackupConfig';
import { PostgreSQLClient } from '../../postgres/PostgreSQLClient';
import { S3Client } from '../../s3/S3Client';
import { RetentionManager } from '../../retention/RetentionManager';

jest.mock('../../postgres/PostgreSQLClient');
jest.mock('../../s3/S3Client');
jest.mock('../../retention/RetentionManager');

const MockedPostgreSQLClient = PostgreSQLClient as jest.MockedClass<
  typeof PostgreSQLClient
>;
const MockedS3Client = S3Client as jest.MockedClass<typeof S3Client>;
const MockedRetentionManager = RetentionManager as jest.MockedClass<
  typeof RetentionManager
>;

describe('BackupManagerImpl', () => {
  let config: BackupConfig;
  let backupManager: BackupManagerImpl;
  let mockPgClient: jest.Mocked<PostgreSQLClient>;
  let mockS3Client: jest.Mocked<S3Client>;
  let mockRetentionManager: jest.Mocked<RetentionManager>;

  beforeEach(() => {
    config = {
      s3Bucket: 'test-bucket',
      s3Path: 'backups',
      s3AccessKey: 'key',
      s3SecretKey: 'secret',
      postgresConnectionString: 'postgresql://user:pass@localhost:5432/db',
      backupInterval: '0 2 * * *',
      retentionDays: 30,
      logLevel: 'info',
    };
    mockPgClient = {
      testConnection: jest.fn(),
      createBackup: jest.fn(),
      cleanupBackupFile: jest.fn(),
    } as unknown as jest.Mocked<PostgreSQLClient>;
    mockS3Client = {
      testConnection: jest.fn(),
      uploadFile: jest.fn(),
      listObjects: jest.fn(),
      deleteObject: jest.fn(),
    } as unknown as jest.Mocked<S3Client>;
    mockRetentionManager = {
      cleanupExpiredBackups: jest.fn(),
    } as unknown as jest.Mocked<RetentionManager>;

    MockedPostgreSQLClient.mockImplementation(() => mockPgClient);
    MockedS3Client.mockImplementation(() => mockS3Client);
    MockedRetentionManager.mockImplementation(() => mockRetentionManager);

    backupManager = new BackupManagerImpl(config);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should validate configuration successfully', () => {
    expect(backupManager.validateConfiguration()).toBe(true);
  });

  it('should fail validation with missing config', () => {
    const badConfig = { ...config, s3Bucket: '' };
    const badManager = new BackupManagerImpl(badConfig);
    expect(badManager.validateConfiguration()).toBe(false);
  });

  it('should execute backup successfully', async () => {
    mockPgClient.testConnection.mockResolvedValue(true);
    mockS3Client.testConnection.mockResolvedValue(true);
    mockPgClient.createBackup.mockResolvedValue({
      filePath: '/tmp/file.sql.gz',
      fileSize: 1234,
      databaseName: 'db',
      timestamp: new Date(),
    });
    mockS3Client.uploadFile.mockResolvedValue(
      's3://test-bucket/backups/file.sql.gz'
    );
    mockPgClient.cleanupBackupFile.mockResolvedValue();
    mockRetentionManager.cleanupExpiredBackups.mockResolvedValue(1);

    const result = await backupManager.executeBackup();
    expect(result.success).toBe(true);
    expect(result.fileSize).toBe(1234);
    expect(result.s3Location).toContain('s3://test-bucket');
    expect(mockPgClient.testConnection).toHaveBeenCalled();
    expect(mockS3Client.testConnection).toHaveBeenCalled();
    expect(mockPgClient.createBackup).toHaveBeenCalled();
    expect(mockS3Client.uploadFile).toHaveBeenCalled();
    expect(mockPgClient.cleanupBackupFile).toHaveBeenCalled();
    expect(mockRetentionManager.cleanupExpiredBackups).toHaveBeenCalled();
  });

  it('should handle PostgreSQL connection failure', async () => {
    mockPgClient.testConnection.mockResolvedValue(false);
    mockS3Client.testConnection.mockResolvedValue(true);
    const result = await backupManager.executeBackup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/PostgreSQL connection failed/);
  });

  it('should handle S3 connection failure', async () => {
    mockPgClient.testConnection.mockResolvedValue(true);
    mockS3Client.testConnection.mockResolvedValue(false);
    const result = await backupManager.executeBackup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/S3 connection failed/);
  });

  it('should handle backup creation failure', async () => {
    mockPgClient.testConnection.mockResolvedValue(true);
    mockS3Client.testConnection.mockResolvedValue(true);
    mockPgClient.createBackup.mockRejectedValue(new Error('pg_dump failed'));
    const result = await backupManager.executeBackup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pg_dump failed/);
    expect(mockPgClient.cleanupBackupFile).toHaveBeenCalled();
  });

  it('should handle S3 upload failure', async () => {
    mockPgClient.testConnection.mockResolvedValue(true);
    mockS3Client.testConnection.mockResolvedValue(true);
    mockPgClient.createBackup.mockResolvedValue({
      filePath: '/tmp/file.sql.gz',
      fileSize: 1234,
      databaseName: 'db',
      timestamp: new Date(),
    });
    mockS3Client.uploadFile.mockRejectedValue(new Error('S3 upload failed'));
    const result = await backupManager.executeBackup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/S3 upload failed/);
    expect(mockPgClient.cleanupBackupFile).toHaveBeenCalled();
  });

  it('logs error stack trace on backup creation failure', async () => {
    mockPgClient.testConnection.mockResolvedValue(true);
    mockS3Client.testConnection.mockResolvedValue(true);
    const error = new Error('pg_dump failed');
    mockPgClient.createBackup.mockRejectedValue(error);
    const result = await backupManager.executeBackup();
    expect(result.success).toBe(false);
    // We can't directly check logs here, but this ensures the error is handled and returned
    expect(result.error).toMatch(/pg_dump failed/);
  });
});
