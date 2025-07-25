import { PostgreSQLClient, PostgreSQLError, ConnectionError, BackupCreationError } from '../src/clients/PostgreSQLClient';
import { Client } from 'pg';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('pg');
jest.mock('child_process');
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn()
  }
}));

const mockClient = {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn()
};

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockFs = fs as jest.Mocked<typeof fs>;
const MockedClient = Client as jest.MockedClass<typeof Client>;

describe('PostgreSQLClient', () => {
  let client: PostgreSQLClient;
  const connectionString = 'postgresql://user:password@localhost:5432/testdb';
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    MockedClient.mockImplementation(() => mockClient as any);
    client = new PostgreSQLClient(connectionString);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should extract database name from URL format connection string', () => {
      const client = new PostgreSQLClient('postgresql://user:pass@host:5432/mydb');
      expect(client.getDatabaseName()).toBe('mydb');
    });

    it('should extract database name from key=value format connection string', () => {
      const client = new PostgreSQLClient('host=localhost port=5432 dbname=mydb user=postgres');
      expect(client.getDatabaseName()).toBe('mydb');
    });

    it('should use default database name for invalid connection string', () => {
      const client = new PostgreSQLClient('invalid-connection-string');
      expect(client.getDatabaseName()).toBe('postgres');
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.query.mockResolvedValue({ rows: [] });
      mockClient.end.mockResolvedValue(undefined);

      const result = await client.testConnection();

      expect(result).toBe(true);
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('should return false for connection failure', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));
      mockClient.end.mockResolvedValue(undefined);

      const result = await client.testConnection();

      expect(result).toBe(false);
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('should return false for query failure', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.query.mockRejectedValue(new Error('Query failed'));
      mockClient.end.mockResolvedValue(undefined);

      const result = await client.testConnection();

      expect(result).toBe(false);
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.query.mockResolvedValue({ rows: [] });
      mockClient.end.mockRejectedValue(new Error('Cleanup failed'));

      const result = await client.testConnection();

      expect(result).toBe(true);
    });
  });

  describe('createBackup', () => {
    const outputPath = '/tmp/backup.sql';
    let mockProcess: any;

    beforeEach(() => {
      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockProcess);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 1024 } as any);
    });

    it('should create backup successfully', async () => {
      const backupPromise = client.createBackup(outputPath);
      
      // Simulate successful pg_dump
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      const result = await backupPromise;

      expect(result).toEqual({
        filePath: outputPath,
        fileSize: 1024,
        databaseName: 'testdb',
        timestamp: expect.any(Date)
      });

      expect(mockSpawn).toHaveBeenCalledWith('pg_dump', [
        connectionString,
        '--no-password',
        '--verbose',
        '--clean',
        '--no-acl',
        '--no-owner',
        '--format=custom',
        '--compress=9',
        '--file', outputPath
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
      expect(mockFs.stat).toHaveBeenCalledWith(outputPath);
    });

    it('should handle pg_dump failure', async () => {
      mockFs.unlink.mockResolvedValue(undefined);
      
      const backupPromise = client.createBackup(outputPath);
      
      // Simulate pg_dump failure
      setTimeout(() => {
        mockProcess.stderr.emit('data', 'Error message');
        mockProcess.emit('close', 1);
      }, 10);

      await expect(backupPromise).rejects.toThrow('pg_dump failed with exit code 1');
      expect(mockFs.unlink).toHaveBeenCalledWith(outputPath);
    });

    it('should handle spawn error', async () => {
      mockFs.unlink.mockResolvedValue(undefined);
      
      const backupPromise = client.createBackup(outputPath);
      
      // Simulate spawn error
      setTimeout(() => {
        mockProcess.emit('error', new Error('Spawn failed'));
      }, 10);

      await expect(backupPromise).rejects.toThrow('Failed to execute pg_dump: Spawn failed');
      expect(mockFs.unlink).toHaveBeenCalledWith(outputPath);
    });

    it('should handle timeout', async () => {
      mockFs.unlink.mockResolvedValue(undefined);
      
      // Mock setTimeout to immediately call the timeout callback
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn().mockImplementation((callback) => {
        setImmediate(callback);
        return 123 as any;
      }) as any;
      
      const backupPromise = client.createBackup(outputPath);
      
      await expect(backupPromise).rejects.toThrow('pg_dump timeout after 30 minutes');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      
      global.setTimeout = originalSetTimeout;
    });

    it('should create output directory if it does not exist', async () => {
      const outputPath = '/path/to/backup/file.sql';
      
      const backupPromise = client.createBackup(outputPath);
      
      // Simulate successful completion
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });

      await backupPromise;

      expect(mockFs.mkdir).toHaveBeenCalledWith('/path/to/backup', { recursive: true });
    });

    it('should handle directory creation for root path', async () => {
      const outputPath = 'backup.sql';
      
      const backupPromise = client.createBackup(outputPath);
      
      // Simulate successful completion
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });

      await backupPromise;

      // Should not try to create directory for root path
      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });

    it('should ignore cleanup errors when backup fails', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Cleanup failed'));
      
      const backupPromise = client.createBackup(outputPath);
      
      // Simulate failure
      setImmediate(() => {
        mockProcess.emit('close', 1);
      });

      await expect(backupPromise).rejects.toThrow('pg_dump failed with exit code 1');
      expect(mockFs.unlink).toHaveBeenCalledWith(outputPath);
    });
  });

  describe('getDatabaseName', () => {
    it('should return the extracted database name', () => {
      expect(client.getDatabaseName()).toBe('testdb');
    });
  });

  describe('enhanced error handling', () => {
    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(console, 'warn').mockImplementation();
    });

    describe('testConnection error handling', () => {
      it('should log detailed error information for connection failures', async () => {
        const pgError = new Error('Connection failed') as any;
        pgError.code = 'ECONNREFUSED';
        pgError.severity = 'FATAL';
        pgError.detail = 'Connection refused';
        
        mockClient.connect.mockRejectedValue(pgError);
        mockClient.end.mockResolvedValue(undefined);

        const result = await client.testConnection();

        expect(result).toBe(false);
        expect(console.error).toHaveBeenCalledWith('PostgreSQL connection test failed:', 'Error: Connection failed');
        expect(console.error).toHaveBeenCalledWith('Connection error details:', {
          name: 'Error',
          message: 'Connection failed',
          code: 'ECONNREFUSED',
          severity: 'FATAL',
          detail: 'Connection refused'
        });
      });

      it('should handle cleanup errors during connection test', async () => {
        mockClient.connect.mockResolvedValue(undefined);
        mockClient.query.mockResolvedValue({ rows: [] });
        
        const cleanupError = new Error('Cleanup failed');
        mockClient.end.mockRejectedValue(cleanupError);

        const result = await client.testConnection();

        expect(result).toBe(true);
        expect(console.warn).toHaveBeenCalledWith('Failed to close database connection during cleanup:', 'Error: Cleanup failed');
      });
    });

    describe('createBackup error handling', () => {
      const outputPath = '/tmp/backup.sql';
      let mockProcess: any;

      beforeEach(() => {
        mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        mockProcess.kill = jest.fn();
        mockProcess.killed = false;
        mockSpawn.mockReturnValue(mockProcess);
        mockFs.mkdir.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({ size: 1024 } as any);
      });

      it('should throw BackupCreationError for directory creation failure', async () => {
        const dirError = new Error('Permission denied');
        mockFs.mkdir.mockRejectedValue(dirError);

        const backupPromise = client.createBackup('/restricted/backup.sql');

        await expect(backupPromise).rejects.toThrow(BackupCreationError);
        await expect(backupPromise).rejects.toThrow('Failed to create output directory /restricted');
      });

      it('should throw BackupCreationError when backup file is not created', async () => {
        const statError = new Error('File not found');
        mockFs.stat.mockRejectedValue(statError);

        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.emit('close', 0);
        });

        await expect(backupPromise).rejects.toThrow(BackupCreationError);
        await expect(backupPromise).rejects.toThrow('Backup file was not created');
      });

      it('should throw BackupCreationError for empty backup file', async () => {
        mockFs.stat.mockResolvedValue({ size: 0 } as any);

        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.emit('close', 0);
        });

        await expect(backupPromise).rejects.toThrow(BackupCreationError);
        await expect(backupPromise).rejects.toThrow('Backup file is empty');
      });

      it('should analyze authentication errors', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stderr.emit('data', 'authentication failed for user');
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow('pg_dump authentication failed (exit code 1)');
      });

      it('should analyze database not found errors', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stderr.emit('data', 'database "nonexistent" does not exist');
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow('pg_dump failed: database "testdb" does not exist');
      });

      it('should analyze permission errors', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stderr.emit('data', 'permission denied for database');
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow('pg_dump failed: insufficient permissions');
      });

      it('should analyze connection errors', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stderr.emit('data', 'connection refused');
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow('pg_dump failed: unable to connect to database server');
      });

      it('should analyze disk space errors', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stderr.emit('data', 'no space left on device');
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow('pg_dump failed: insufficient disk space');
      });

      it('should analyze memory errors', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stderr.emit('data', 'out of memory');
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow('pg_dump failed: insufficient memory');
      });

      it('should handle spawn ENOENT error', async () => {
        const spawnError = new Error('spawn pg_dump ENOENT');
        
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.emit('error', spawnError);
        });

        await expect(backupPromise).rejects.toThrow('pg_dump command not found');
      });

      it('should handle spawn permission error', async () => {
        const spawnError = new Error('spawn EACCES');
        
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.emit('error', spawnError);
        });

        await expect(backupPromise).rejects.toThrow('Permission denied executing pg_dump');
      });

      it('should log progress during backup', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stdout.emit('data', 'COPY table1 (id, name) FROM stdin;');
          mockProcess.stdout.emit('data', 'CREATE TABLE table2');
          mockProcess.emit('close', 0);
        });

        await backupPromise;

        expect(console.log).toHaveBeenCalledWith('pg_dump progress: processing data...');
      });

      it('should log warnings without failing backup', async () => {
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.stderr.emit('data', 'WARNING: some warning message\n');
          mockProcess.stderr.emit('data', 'NOTICE: some notice message\n');
          mockProcess.emit('close', 0);
        });

        const result = await backupPromise;

        expect(result.fileSize).toBe(1024);
        expect(console.warn).toHaveBeenCalledWith('pg_dump warning:', 'WARNING: some warning message');
        expect(console.warn).toHaveBeenCalledWith('pg_dump warning:', 'NOTICE: some notice message');
      });

      it('should handle timeout with graceful and force termination', async () => {
        mockFs.unlink.mockResolvedValue(undefined);
        
        // Mock setTimeout to control timeout behavior
        const timeoutCallbacks: (() => void)[] = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = jest.fn().mockImplementation((callback, delay) => {
          if (delay === 30 * 60 * 1000) { // Main timeout
            setImmediate(callback);
          } else if (delay === 10000) { // Force kill timeout
            timeoutCallbacks.push(callback);
          }
          return 123 as any;
        }) as any;
        
        const backupPromise = client.createBackup(outputPath);
        
        // Simulate force kill timeout
        setImmediate(() => {
          timeoutCallbacks.forEach(cb => cb());
        });

        await expect(backupPromise).rejects.toThrow('pg_dump timeout after 30 minutes');
        expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
        expect(console.warn).toHaveBeenCalledWith('pg_dump timeout reached, terminating process...');
        
        global.setTimeout = originalSetTimeout;
      });

      it('should cleanup partial backup file on failure', async () => {
        mockFs.unlink.mockResolvedValue(undefined);
        
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow();
        expect(mockFs.unlink).toHaveBeenCalledWith(outputPath);
        expect(console.log).toHaveBeenCalledWith(`Cleaned up partial backup file: ${outputPath}`);
      });

      it('should handle cleanup failure gracefully', async () => {
        const cleanupError = new Error('Cleanup failed');
        mockFs.unlink.mockRejectedValue(cleanupError);
        
        const backupPromise = client.createBackup(outputPath);
        
        setImmediate(() => {
          mockProcess.emit('close', 1);
        });

        await expect(backupPromise).rejects.toThrow();
        expect(console.warn).toHaveBeenCalledWith(`Failed to cleanup partial backup file ${outputPath}:`, 'Error: Cleanup failed');
      });
    });

    describe('custom error types', () => {
      it('should create PostgreSQLError with proper properties', () => {
        const cause = new Error('Original error');
        const pgError = new PostgreSQLError('Database error', 'test_operation', cause);

        expect(pgError.name).toBe('PostgreSQLError');
        expect(pgError.message).toBe('Database error');
        expect(pgError.operation).toBe('test_operation');
        expect(pgError.cause).toBe(cause);
        expect(pgError.stack).toContain('Caused by:');
      });

      it('should create ConnectionError with proper properties', () => {
        const cause = new Error('Connection failed');
        const connError = new ConnectionError('Cannot connect', cause);

        expect(connError.name).toBe('ConnectionError');
        expect(connError.message).toBe('Cannot connect');
        expect(connError.operation).toBe('connection');
        expect(connError.cause).toBe(cause);
      });

      it('should create BackupCreationError with proper properties', () => {
        const cause = new Error('Backup failed');
        const backupError = new BackupCreationError('Cannot create backup', 1, cause);

        expect(backupError.name).toBe('BackupCreationError');
        expect(backupError.message).toBe('Cannot create backup');
        expect(backupError.operation).toBe('backup_creation');
        expect(backupError.exitCode).toBe(1);
        expect(backupError.cause).toBe(cause);
      });
    });
  });
});