import { exec } from 'child_process';
import { promisify } from 'util';
import { BackupInfo } from '../interfaces/PostgreSQLClient';
import { BackupConfig } from '../interfaces/BackupConfig';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export class PostgreSQLClient {
  private config: BackupConfig;

  constructor(config: BackupConfig) {
    this.config = config;
  }

  public async testConnection(): Promise<boolean> {
    try {
      // Use pg_dump with --schema-only for a quick connection test
      const testCommand = `pg_dump --schema-only --dbname="${this.config.postgresConnectionString}" --no-password`;

      await execAsync(testCommand, { timeout: 10000 }); // 10 second timeout
      return true;
    } catch (error) {
      console.error('PostgreSQL connection test failed:', error);
      return false;
    }
  }

  public async createBackup(outputPath: string): Promise<BackupInfo> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Extract database name from connection string
      const databaseName = this.extractDatabaseName(
        this.config.postgresConnectionString
      );

      // Build pg_dump command with compression
      const dumpCommand = `pg_dump --verbose --clean --no-owner --no-privileges --dbname="${this.config.postgresConnectionString}" --no-password | gzip > "${outputPath}"`;

      console.log(`Starting backup of database: ${databaseName}`);
      const startTime = Date.now();

      const { stderr } = await execAsync(dumpCommand, {
        timeout: 3600000, // 1 hour timeout
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Check if backup file was created and has content
      if (!fs.existsSync(outputPath)) {
        throw new Error('Backup file was not created');
      }

      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        throw new Error('Backup file is empty');
      }

      console.log(`Backup completed successfully in ${duration}ms`);
      console.log(`Backup file: ${outputPath} (${stats.size} bytes)`);

      if (stderr) {
        console.warn('pg_dump warnings:', stderr);
      }

      return {
        filePath: outputPath,
        fileSize: stats.size,
        databaseName,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('Backup creation failed:', error);
      throw new Error(
        `Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private extractDatabaseName(connectionString: string): string {
    try {
      // Parse connection string to extract database name
      const url = new URL(connectionString.replace('postgresql://', 'http://'));
      const pathname = url.pathname;

      // Remove leading slash and get database name
      const dbName = pathname.substring(1);

      if (!dbName) {
        throw new Error('No database name found in connection string');
      }

      return dbName;
    } catch (error) {
      // Fallback: try to extract from connection string manually
      const match = connectionString.match(/\/\/([^:]+:[^@]+@)?[^/]+\/([^?]+)/);
      if (match && match[2]) {
        return match[2];
      }

      throw new Error('Could not extract database name from connection string');
    }
  }

  public async cleanupBackupFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up backup file: ${filePath}`);
      }
    } catch (error) {
      console.error(`Failed to cleanup backup file ${filePath}:`, error);
    }
  }
}
