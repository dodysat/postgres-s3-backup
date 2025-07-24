import { PostgreSQLClient } from '../src/clients/PostgreSQLClient';
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

      await expect(backupPromise).rejects.toThrow('Failed to spawn pg_dump: Spawn failed');
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
});