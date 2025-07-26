import { ConfigurationManager } from '../../config/ConfigurationManager';
import { BackupManagerImpl } from '../../backup/BackupManager';
import { S3Client } from '../../s3/S3Client';
import { PostgreSQLClient } from '../../postgres/PostgreSQLClient';
import { RetentionManager } from '../../retention/RetentionManager';

jest.mock('../../s3/S3Client');
jest.mock('../../postgres/PostgreSQLClient');
jest.mock('../../retention/RetentionManager');

describe('Integration: Backup Workflow', () => {
  let configManager: ConfigurationManager;
  let backupManager: BackupManagerImpl;
  let mockPgClient: jest.Mocked<PostgreSQLClient>;
  let mockS3Client: jest.Mocked<S3Client>;
  let mockRetentionManager: jest.Mocked<RetentionManager>;

  beforeEach(() => {
    process.env['S3_BUCKET'] = 'test-bucket';
    process.env['S3_ACCESS_KEY'] = 'key';
    process.env['S3_SECRET_KEY'] = 'secret';
    process.env['POSTGRES_CONNECTION_STRING'] =
      'postgresql://user:pass@localhost:5432/db';
    process.env['BACKUP_INTERVAL'] = '0 2 * * *';
    process.env['S3_PATH'] = 'backups';
    process.env['BACKUP_RETENTION_DAYS'] = '30';
    process.env['LOG_LEVEL'] = 'info';

    configManager = new ConfigurationManager();
    const config = configManager.getConfig();

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

    (S3Client as any).mockImplementation(() => mockS3Client);
    (PostgreSQLClient as any).mockImplementation(() => mockPgClient);
    (RetentionManager as any).mockImplementation(() => mockRetentionManager);

    backupManager = new BackupManagerImpl(config);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('runs a successful backup and retention flow', async () => {
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
    expect(mockRetentionManager.cleanupExpiredBackups).toHaveBeenCalled();
  });

  it('handles S3 upload failure and recovers', async () => {
    mockPgClient.testConnection.mockResolvedValue(true);
    mockS3Client.testConnection.mockResolvedValue(true);
    mockPgClient.createBackup.mockResolvedValue({
      filePath: '/tmp/file.sql.gz',
      fileSize: 1234,
      databaseName: 'db',
      timestamp: new Date(),
    });
    mockS3Client.uploadFile.mockRejectedValue(new Error('S3 upload failed'));
    mockPgClient.cleanupBackupFile.mockResolvedValue();

    const result = await backupManager.executeBackup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/S3 upload failed/);
    expect(mockPgClient.cleanupBackupFile).toHaveBeenCalled();
  });

  it('handles database connection failure', async () => {
    mockPgClient.testConnection.mockResolvedValue(false);
    mockS3Client.testConnection.mockResolvedValue(true);
    const result = await backupManager.executeBackup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/PostgreSQL connection failed/);
  });

  it('validates environment variable errors', () => {
    delete process.env['S3_BUCKET'];
    expect(() => new ConfigurationManager()).toThrow(
      /Missing required environment variables/
    );
  });
});
