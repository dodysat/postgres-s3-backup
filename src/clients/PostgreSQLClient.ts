import { Client } from 'pg';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { PostgreSQLClient as IPostgreSQLClient, BackupInfo } from '../interfaces/PostgreSQLClient';

/**
 * PostgreSQL client implementation for database operations and backups
 */
export class PostgreSQLClient implements IPostgreSQLClient {
  private connectionString: string;
  private databaseName: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.databaseName = this.extractDatabaseName(connectionString);
  }

  /**
   * Test connection to the PostgreSQL database
   */
  async testConnection(): Promise<boolean> {
    const client = new Client({ connectionString: this.connectionString });
    
    try {
      await client.connect();
      await client.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('PostgreSQL connection test failed:', error);
      return false;
    } finally {
      await client.end().catch(() => {
        // Ignore cleanup errors
      });
    }
  }

  /**
   * Create a compressed backup of the database using pg_dump
   */
  async createBackup(outputPath: string): Promise<BackupInfo> {
    const timestamp = new Date();
    
    try {
      // Ensure output directory exists
      const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
      if (outputDir) {
        await fs.mkdir(outputDir, { recursive: true });
      }

      // Execute pg_dump with compression
      await this.executePgDump(outputPath);
      
      // Get file stats
      const stats = await fs.stat(outputPath);
      
      return {
        filePath: outputPath,
        fileSize: stats.size,
        databaseName: this.databaseName,
        timestamp
      };
    } catch (error) {
      // Clean up partial file if it exists
      try {
        await fs.unlink(outputPath);
      } catch {
        // Ignore cleanup errors
      }
      
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get database name from connection string
   */
  getDatabaseName(): string {
    return this.databaseName;
  }

  /**
   * Execute pg_dump command with proper error handling
   */
  private async executePgDump(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        this.connectionString,
        '--no-password',
        '--verbose',
        '--clean',
        '--no-acl',
        '--no-owner',
        '--format=custom',
        '--compress=9',
        '--file', outputPath
      ];

      const pgDump = spawn('pg_dump', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stderr = '';
      let stdout = '';

      pgDump.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pgDump.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pgDump.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_dump failed with exit code ${code}. stderr: ${stderr}`));
        }
      });

      pgDump.on('error', (error) => {
        reject(new Error(`Failed to spawn pg_dump: ${error.message}`));
      });

      // Set timeout for long-running backups (30 minutes)
      const timeout = setTimeout(() => {
        pgDump.kill('SIGTERM');
        reject(new Error('pg_dump timeout after 30 minutes'));
      }, 30 * 60 * 1000);

      pgDump.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Extract database name from PostgreSQL connection string
   */
  private extractDatabaseName(connectionString: string): string {
    try {
      // Handle both URL format and key=value format
      if (connectionString.startsWith('postgresql://') || connectionString.startsWith('postgres://')) {
        const url = new URL(connectionString);
        return url.pathname.substring(1) || 'postgres';
      } else {
        // Parse key=value format
        const params = connectionString.split(' ');
        for (const param of params) {
          const [key, value] = param.split('=');
          if (key === 'dbname') {
            return value;
          }
        }
        return 'postgres';
      }
    } catch (error) {
      console.warn('Failed to extract database name from connection string, using default');
      return 'postgres';
    }
  }
}