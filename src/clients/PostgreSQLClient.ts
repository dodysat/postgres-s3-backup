import { Client } from 'pg';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { PostgreSQLClient as IPostgreSQLClient, BackupInfo } from '../interfaces/PostgreSQLClient';

/**
 * Custom error classes for PostgreSQL operations
 */
export class PostgreSQLError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PostgreSQLError';
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class ConnectionError extends PostgreSQLError {
  constructor(message: string, cause?: Error) {
    super(message, 'connection', cause);
    this.name = 'ConnectionError';
  }
}

export class BackupCreationError extends PostgreSQLError {
  constructor(
    message: string,
    public readonly exitCode?: number,
    cause?: Error
  ) {
    super(message, 'backup_creation', cause);
    this.name = 'BackupCreationError';
  }
}

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
   * Test connection to the PostgreSQL database with enhanced error handling
   */
  async testConnection(): Promise<boolean> {
    const client = new Client({ connectionString: this.connectionString });

    try {
      await client.connect();
      await client.query('SELECT 1');
      return true;
    } catch (error) {
      const formattedError = this.formatError(error);
      console.error('PostgreSQL connection test failed:', formattedError);

      // Log additional context for debugging
      if (error instanceof Error) {
        console.error('Connection error details:', {
          name: error.name,
          message: error.message,
          code: (error as any).code,
          severity: (error as any).severity,
          detail: (error as any).detail,
        });
      }

      return false;
    } finally {
      await client.end().catch(cleanupError => {
        console.warn(
          'Failed to close database connection during cleanup:',
          this.formatError(cleanupError)
        );
      });
    }
  }

  /**
   * Create a compressed backup of the database using pg_dump with enhanced error handling
   */
  async createBackup(outputPath: string): Promise<BackupInfo> {
    const timestamp = new Date();

    try {
      console.log(`Creating PostgreSQL backup for database: ${this.databaseName}`);

      // Ensure output directory exists
      const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
      if (outputDir) {
        try {
          await fs.mkdir(outputDir, { recursive: true });
        } catch (error) {
          throw new BackupCreationError(
            `Failed to create output directory ${outputDir}: ${this.formatError(error)}`,
            undefined,
            error instanceof Error ? error : undefined
          );
        }
      }

      // Execute pg_dump with compression
      await this.executePgDump(outputPath);

      // Verify backup file was created and get stats
      let stats;
      try {
        stats = await fs.stat(outputPath);
      } catch (error) {
        throw new BackupCreationError(
          `Backup file was not created at ${outputPath}: ${this.formatError(error)}`,
          undefined,
          error instanceof Error ? error : undefined
        );
      }

      // Validate backup file size
      if (stats.size === 0) {
        throw new BackupCreationError(`Backup file is empty: ${outputPath}`, undefined);
      }

      console.log(`PostgreSQL backup created successfully: ${stats.size} bytes`);

      return {
        filePath: outputPath,
        fileSize: stats.size,
        databaseName: this.databaseName,
        timestamp,
      };
    } catch (error) {
      // Clean up partial file if it exists
      try {
        await fs.unlink(outputPath);
        console.log(`Cleaned up partial backup file: ${outputPath}`);
      } catch (cleanupError) {
        console.warn(
          `Failed to cleanup partial backup file ${outputPath}:`,
          this.formatError(cleanupError)
        );
      }

      // Re-throw with proper error type
      if (error instanceof BackupCreationError) {
        throw error;
      }

      throw new BackupCreationError(
        `Failed to create backup: ${this.formatError(error)}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get database name from connection string
   */
  getDatabaseName(): string {
    return this.databaseName;
  }

  /**
   * Execute pg_dump command with enhanced error handling and recovery
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
        '--file',
        outputPath,
      ];

      console.log(`Executing pg_dump for database: ${this.databaseName}`);

      const pgDump = spawn('pg_dump', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stderr = '';
      let stdout = '';
      let isTimedOut = false;

      pgDump.stdout.on('data', data => {
        stdout += data.toString();
        // Log progress for long-running backups
        if (stdout.includes('COPY') || stdout.includes('CREATE')) {
          console.log('pg_dump progress: processing data...');
        }
      });

      pgDump.stderr.on('data', data => {
        const chunk = data.toString();
        stderr += chunk;

        // Log warnings but don't fail the backup
        if (chunk.includes('WARNING') || chunk.includes('NOTICE')) {
          console.warn('pg_dump warning:', chunk.trim());
        }
      });

      pgDump.on('close', code => {
        if (isTimedOut) {
          return; // Timeout handler already called reject
        }

        if (code === 0) {
          console.log('pg_dump completed successfully');
          resolve();
        } else {
          const exitCode = code ?? -1; // Handle null case
          const errorMessage = this.analyzePgDumpError(exitCode, stderr, stdout);
          reject(new BackupCreationError(errorMessage, exitCode));
        }
      });

      pgDump.on('error', error => {
        if (isTimedOut) {
          return; // Timeout handler already called reject
        }

        const errorMessage = this.analyzePgDumpSpawnError(error);
        reject(new BackupCreationError(errorMessage, undefined, error));
      });

      // Set timeout for long-running backups (30 minutes)
      const timeout = setTimeout(
        () => {
          isTimedOut = true;
          console.warn('pg_dump timeout reached, terminating process...');

          // Try graceful termination first
          pgDump.kill('SIGTERM');

          // Force kill after 10 seconds if still running
          setTimeout(() => {
            if (!pgDump.killed) {
              console.warn('Force killing pg_dump process...');
              pgDump.kill('SIGKILL');
            }
          }, 10000);

          reject(
            new BackupCreationError(
              'pg_dump timeout after 30 minutes. This may indicate a very large database or connection issues.'
            )
          );
        },
        30 * 60 * 1000
      );

      pgDump.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Analyze pg_dump error and provide helpful error messages
   */
  private analyzePgDumpError(exitCode: number, stderr: string, stdout: string): string {
    const lowerStderr = stderr.toLowerCase();

    // Common pg_dump error patterns
    if (
      lowerStderr.includes('authentication failed') ||
      lowerStderr.includes('password authentication failed')
    ) {
      return `pg_dump authentication failed (exit code ${exitCode}). Please check database credentials.`;
    }

    if (lowerStderr.includes('database') && lowerStderr.includes('does not exist')) {
      return `pg_dump failed: database "${this.databaseName}" does not exist (exit code ${exitCode}).`;
    }

    if (lowerStderr.includes('permission denied') || lowerStderr.includes('access denied')) {
      return `pg_dump failed: insufficient permissions to access database (exit code ${exitCode}).`;
    }

    if (
      lowerStderr.includes('connection') &&
      (lowerStderr.includes('refused') || lowerStderr.includes('timeout'))
    ) {
      return `pg_dump failed: unable to connect to database server (exit code ${exitCode}). Please check connection settings.`;
    }

    if (lowerStderr.includes('no space left on device') || lowerStderr.includes('disk full')) {
      return `pg_dump failed: insufficient disk space (exit code ${exitCode}).`;
    }

    if (lowerStderr.includes('out of memory')) {
      return `pg_dump failed: insufficient memory (exit code ${exitCode}).`;
    }

    // Generic error with context
    const errorContext =
      stderr.trim() || stdout.trim() || 'No additional error information available';
    return `pg_dump failed with exit code ${exitCode}. Error details: ${errorContext}`;
  }

  /**
   * Analyze pg_dump spawn errors
   */
  private analyzePgDumpSpawnError(error: Error): string {
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('enoent') || errorMessage.includes('command not found')) {
      return 'pg_dump command not found. Please ensure PostgreSQL client tools are installed.';
    }

    if (errorMessage.includes('eacces') || errorMessage.includes('permission denied')) {
      return 'Permission denied executing pg_dump. Please check file permissions.';
    }

    return `Failed to execute pg_dump: ${error.message}`;
  }

  /**
   * Format error for consistent logging
   */
  private formatError(error: any): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  /**
   * Extract database name from PostgreSQL connection string
   */
  private extractDatabaseName(connectionString: string): string {
    try {
      // Handle both URL format and key=value format
      if (
        connectionString.startsWith('postgresql://') ||
        connectionString.startsWith('postgres://')
      ) {
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
