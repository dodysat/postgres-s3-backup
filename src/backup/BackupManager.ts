import { BackupManager, BackupResult } from '../interfaces/BackupManager';
import { BackupConfig } from '../interfaces/BackupConfig';
import { PostgreSQLClient } from '../postgres/PostgreSQLClient';
import { S3Client } from '../s3/S3Client';
import { RetentionManager } from '../retention/RetentionManager';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

export class BackupManagerImpl implements BackupManager {
  private config: BackupConfig;
  private pgClient: PostgreSQLClient;
  private s3Client: S3Client;
  private retentionManager: RetentionManager;

  constructor(config: BackupConfig) {
    this.config = config;
    this.pgClient = new PostgreSQLClient(config);
    this.s3Client = new S3Client(config);
    this.retentionManager = new RetentionManager(this.s3Client, config);
  }

  public validateConfiguration(): boolean {
    // Validate all components
    try {
      if (!this.config) return false;
      if (
        !this.config.s3Bucket ||
        !this.config.s3AccessKey ||
        !this.config.s3SecretKey ||
        !this.config.postgresConnectionString ||
        !this.config.backupInterval
      ) {
        return false;
      }
      // Validate cron expression (basic check)
      const cronParts = this.config.backupInterval.trim().split(/\s+/);
      if (cronParts.length !== 5 && cronParts.length !== 6) return false;
      return true;
    } catch {
      return false;
    }
  }

  public async executeBackup(): Promise<BackupResult> {
    const start = Date.now();
    let backupFilePath = '';
    let fileName = '';
    let fileSize = 0;
    let s3Location = '';
    try {
      // 1. Test connections
      const pgOk = await this.pgClient.testConnection();
      const s3Ok = await this.s3Client.testConnection();
      if (!pgOk) throw new Error('PostgreSQL connection failed');
      if (!s3Ok) throw new Error('S3 connection failed');

      // 2. Create backup file name
      const now = new Date();
      const timestamp = now
        .toISOString()
        .replace(/[:T]/g, '-')
        .replace(/\..+/, '');
      fileName = `postgres-backup-${timestamp}.sql.gz`;
      const s3Key = path.posix.join(this.config.s3Path || '', fileName);
      backupFilePath = path.join(os.tmpdir(), `${uuidv4()}-${fileName}`);

      // 3. Create backup
      const backupInfo = await this.pgClient.createBackup(backupFilePath);
      fileSize = backupInfo.fileSize;

      // 4. Upload to S3
      s3Location = await this.s3Client.uploadFile(backupFilePath, s3Key);

      // 5. Cleanup local file
      await this.pgClient.cleanupBackupFile(backupFilePath);

      // 6. Retention cleanup
      if (this.config.retentionDays) {
        await this.retentionManager.cleanupExpiredBackups();
      }

      const duration = Date.now() - start;
      return {
        success: true,
        fileName,
        fileSize,
        s3Location,
        duration,
      };
    } catch (error: any) {
      // Cleanup temp file if exists
      if (backupFilePath) {
        await this.pgClient.cleanupBackupFile(backupFilePath);
      }
      return {
        success: false,
        fileName,
        fileSize,
        s3Location,
        duration: Date.now() - start,
        error: error?.message || String(error),
      };
    }
  }
}
