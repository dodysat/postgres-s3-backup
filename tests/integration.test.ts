import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigurationManager } from '../src/config/ConfigurationManager';
import { BackupManager } from '../src/clients/BackupManager';
import { PostgreSQLClient } from '../src/clients/PostgreSQLClient';
import { S3Client } from '../src/clients/S3Client';
import { RetentionManager } from '../src/clients/RetentionManager';
import { CronScheduler } from '../src/clients/CronScheduler';

// Mock AWS SDK for S3 operations
jest.mock('@aws-sdk/client-s3', () => {
    const mockS3Client = {
        send: jest.fn(),
    };

    return {
        S3Client: jest.fn(() => mockS3Client),
        PutObjectCommand: jest.fn(),
        ListObjectsV2Command: jest.fn(),
        DeleteObjectCommand: jest.fn(),
        HeadBucketCommand: jest.fn(),
    };
});

// Mock pg_dump process
jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

// Mock node-cron
jest.mock('node-cron', () => ({
    schedule: jest.fn(),
    validate: jest.fn(),
}));

describe('Integration Tests', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let testTempDir: string;
    let mockS3Client: any;
    let mockSpawn: jest.MockedFunction<typeof spawn>;

    beforeAll(async () => {
        // Save original environment
        originalEnv = { ...process.env };

        // Create temporary directory for test files
        testTempDir = await fs.mkdtemp(join(tmpdir(), 'postgres-backup-test-'));

        // Setup AWS SDK mocks
        const { S3Client } = require('@aws-sdk/client-s3');
        mockS3Client = new S3Client();

        // Setup child_process mocks
        mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
    });

    afterAll(async () => {
        // Restore original environment
        process.env = originalEnv;

        // Cleanup test directory
        try {
            await fs.rmdir(testTempDir, { recursive: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Reset environment to clean state
        process.env = { ...originalEnv };

        // Clear backup-related env vars
        delete process.env.S3_BUCKET;
        delete process.env.S3_ACCESS_KEY;
        delete process.env.S3_SECRET_KEY;
        delete process.env.POSTGRES_CONNECTION_STRING;
        delete process.env.BACKUP_INTERVAL;
        delete process.env.S3_URL;
        delete process.env.S3_PATH;
        delete process.env.BACKUP_RETENTION_DAYS;
        delete process.env.LOG_LEVEL;

        // Mock console methods to reduce test noise
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'info').mockImplementation();

        // Mock process.exit to prevent actual exits during tests
        jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
            throw new Error(`process.exit called with "${code}"`);
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('End-to-End Backup Workflow', () => {
        const validEnvConfig = {
            S3_BUCKET: 'test-backup-bucket',
            S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
            S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
            BACKUP_INTERVAL: '0 2 * * *',
            S3_PATH: 'integration-test-backups',
            BACKUP_RETENTION_DAYS: '7',
            LOG_LEVEL: 'info'
        };

        it('should execute complete backup workflow successfully', async () => {
            // Arrange
            Object.assign(process.env, validEnvConfig);

            // Mock successful pg_dump process
            const mockPgDumpProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        // Simulate successful pg_dump completion
                        setTimeout(() => callback(0), 100);
                    }
                }),
                kill: jest.fn(),
            } as any;

            mockSpawn.mockReturnValue(mockPgDumpProcess);

            // Mock successful S3 operations
            mockS3Client.send.mockImplementation((command: any) => {
                const commandName = command.constructor.name;

                switch (commandName) {
                    case 'HeadBucketCommand':
                        return Promise.resolve({}); // Bucket exists
                    case 'PutObjectCommand':
                        return Promise.resolve({
                            ETag: '"test-etag"',
                            Location: `s3://${validEnvConfig.S3_BUCKET}/${validEnvConfig.S3_PATH}/test-backup.sql.gz`
                        });
                    case 'ListObjectsV2Command':
                        return Promise.resolve({
                            Contents: [
                                {
                                    Key: `${validEnvConfig.S3_PATH}/postgres-backup-2024-01-01_02-00-00.sql.gz`,
                                    LastModified: new Date('2024-01-01T02:00:00Z'),
                                    Size: 1024000
                                },
                                {
                                    Key: `${validEnvConfig.S3_PATH}/postgres-backup-2024-01-08_02-00-00.sql.gz`,
                                    LastModified: new Date('2024-01-08T02:00:00Z'),
                                    Size: 2048000
                                }
                            ]
                        });
                    case 'DeleteObjectCommand':
                        return Promise.resolve({});
                    default:
                        return Promise.resolve({});
                }
            });

            // Create test backup file
            const testBackupFile = join(testTempDir, 'test-backup.sql.gz');
            await fs.writeFile(testBackupFile, 'mock backup data');

            // Mock file system operations
            jest.spyOn(require('fs'), 'createReadStream').mockReturnValue({
                pipe: jest.fn(),
                on: jest.fn(),
                destroy: jest.fn(),
            } as any);

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const postgresClient = new PostgreSQLClient(config.postgresConnectionString);
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);
            const backupManager = new BackupManager(postgresClient, s3Client, retentionManager, config);

            const result = await backupManager.executeBackup();

            // Assert
            expect(result.success).toBe(true);
            expect(result.fileName).toMatch(/^postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/);
            expect(result.fileSize).toBeGreaterThan(0);
            expect(result.s3Location).toContain(validEnvConfig.S3_BUCKET);
            expect(result.duration).toBeGreaterThanOrEqual(0);
            expect(result.error).toBeUndefined();

            // Verify pg_dump was called with correct parameters
            expect(mockSpawn).toHaveBeenCalledWith(
                'pg_dump',
                expect.arrayContaining([
                    '--no-password',
                    '--verbose',
                    '--format=custom',
                    '--compress=9',
                    '--file',
                    expect.stringMatching(/postgres-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql\.gz$/),
                    validEnvConfig.POSTGRES_CONNECTION_STRING
                ]),
                expect.objectContaining({
                    stdio: ['ignore', 'pipe', 'pipe']
                })
            );

            // Verify S3 operations were called
            expect(mockS3Client.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: { name: 'HeadBucketCommand' }
                })
            );
            expect(mockS3Client.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: { name: 'PutObjectCommand' }
                })
            );
        }, 15000);

        it('should handle PostgreSQL connection failure gracefully', async () => {
            // Arrange
            Object.assign(process.env, {
                ...validEnvConfig,
                POSTGRES_CONNECTION_STRING: 'postgresql://invalid:invalid@nonexistent:5432/invalid'
            });

            // Mock failed pg_dump process
            const mockPgDumpProcess = {
                stdout: { on: jest.fn() },
                stderr: {
                    on: jest.fn((event, callback) => {
                        if (event === 'data') {
                            callback(Buffer.from('pg_dump: error: connection to database failed'));
                        }
                    })
                },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        // Simulate pg_dump failure
                        setTimeout(() => callback(1), 100);
                    }
                }),
                kill: jest.fn(),
            } as any;

            mockSpawn.mockReturnValue(mockPgDumpProcess);

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const postgresClient = new PostgreSQLClient(config.postgresConnectionString);
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);
            const backupManager = new BackupManager(postgresClient, s3Client, retentionManager, config);

            const result = await backupManager.executeBackup();

            // Assert
            expect(result.success).toBe(false);
            expect(result.error).toContain('pg_dump process failed');
            expect(result.fileName).toBe('');
            expect(result.fileSize).toBe(0);
            expect(result.s3Location).toBe('');

            // Verify S3 upload was not attempted
            expect(mockS3Client.send).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: { name: 'PutObjectCommand' }
                })
            );
        });

        it('should handle S3 upload failure and retry', async () => {
            // Arrange
            Object.assign(process.env, validEnvConfig);

            // Mock successful pg_dump process
            const mockPgDumpProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        setTimeout(() => callback(0), 100);
                    }
                }),
                kill: jest.fn(),
            } as any;

            mockSpawn.mockReturnValue(mockPgDumpProcess);

            // Mock S3 operations - HeadBucket succeeds, PutObject fails then succeeds
            let putObjectCallCount = 0;
            mockS3Client.send.mockImplementation((command: any) => {
                const commandName = command.constructor.name;

                switch (commandName) {
                    case 'HeadBucketCommand':
                        return Promise.resolve({});
                    case 'PutObjectCommand':
                        putObjectCallCount++;
                        if (putObjectCallCount === 1) {
                            return Promise.reject(new Error('Network timeout'));
                        }
                        return Promise.resolve({
                            ETag: '"test-etag"',
                            Location: `s3://${validEnvConfig.S3_BUCKET}/${validEnvConfig.S3_PATH}/test-backup.sql.gz`
                        });
                    default:
                        return Promise.resolve({});
                }
            });

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const postgresClient = new PostgreSQLClient(config.postgresConnectionString);
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);
            const backupManager = new BackupManager(postgresClient, s3Client, retentionManager, config);

            const result = await backupManager.executeBackup();

            // Assert
            expect(result.success).toBe(true);
            expect(putObjectCallCount).toBe(2); // Initial attempt + 1 retry
        }, 15000);
    });

    describe('Retention Cleanup Functionality', () => {
        const retentionTestConfig = {
            S3_BUCKET: 'test-retention-bucket',
            S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
            S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
            BACKUP_INTERVAL: '0 2 * * *',
            S3_PATH: 'retention-test-backups',
            BACKUP_RETENTION_DAYS: '3',
            LOG_LEVEL: 'info'
        };

        it('should delete expired backups based on retention policy', async () => {
            // Arrange
            Object.assign(process.env, retentionTestConfig);

            const now = new Date();
            const expiredDate1 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
            const expiredDate2 = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000); // 4 days ago
            const validDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

            // Mock S3 list operation returning mix of expired and valid backups
            mockS3Client.send.mockImplementation((command: any) => {
                const commandName = command.constructor.name;

                switch (commandName) {
                    case 'ListObjectsV2Command':
                        return Promise.resolve({
                            Contents: [
                                {
                                    Key: `${retentionTestConfig.S3_PATH}/postgres-backup-2024-01-01_02-00-00.sql.gz`,
                                    LastModified: expiredDate1,
                                    Size: 1024000
                                },
                                {
                                    Key: `${retentionTestConfig.S3_PATH}/postgres-backup-2024-01-02_02-00-00.sql.gz`,
                                    LastModified: expiredDate2,
                                    Size: 1024000
                                },
                                {
                                    Key: `${retentionTestConfig.S3_PATH}/postgres-backup-2024-01-05_02-00-00.sql.gz`,
                                    LastModified: validDate,
                                    Size: 1024000
                                },
                                {
                                    Key: `${retentionTestConfig.S3_PATH}/other-file.txt`, // Non-backup file
                                    LastModified: expiredDate1,
                                    Size: 1000
                                }
                            ]
                        });
                    case 'DeleteObjectCommand':
                        return Promise.resolve({});
                    default:
                        return Promise.resolve({});
                }
            });

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);

            const result = await retentionManager.cleanupExpiredBackups(config.s3Path || '');

            // Assert
            expect(result.deletedCount).toBe(2); // Only the 2 expired backup files
            expect(result.totalCount).toBe(3); // 3 backup files total (excluding other-file.txt)
            expect(result.deletedKeys).toEqual([
                `${retentionTestConfig.S3_PATH}/postgres-backup-2024-01-01_02-00-00.sql.gz`,
                `${retentionTestConfig.S3_PATH}/postgres-backup-2024-01-02_02-00-00.sql.gz`
            ]);
            expect(result.errors).toHaveLength(0);

            // Verify delete operations were called for expired backups only
            expect(mockS3Client.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: { name: 'DeleteObjectCommand' }
                })
            );

            // Count delete calls
            const deleteCalls = mockS3Client.send.mock.calls.filter((call: any) =>
                call[0].constructor.name === 'DeleteObjectCommand'
            );
            expect(deleteCalls).toHaveLength(2);
        });

        it('should skip retention cleanup when BACKUP_RETENTION_DAYS is not set', async () => {
            // Arrange
            const configWithoutRetention = { ...retentionTestConfig };
            delete (configWithoutRetention as any).BACKUP_RETENTION_DAYS;
            Object.assign(process.env, configWithoutRetention);

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);

            const result = await retentionManager.cleanupExpiredBackups(config.s3Path || '');

            // Assert
            expect(result.deletedCount).toBe(0);
            expect(result.totalCount).toBe(0);
            expect(result.deletedKeys).toHaveLength(0);
            expect(result.errors).toHaveLength(0);

            // Verify no S3 operations were performed
            expect(mockS3Client.send).not.toHaveBeenCalled();
        });
    });

    describe('Scheduled Backup Execution', () => {
        const schedulingTestConfig = {
            S3_BUCKET: 'test-scheduling-bucket',
            S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
            S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
            BACKUP_INTERVAL: '*/5 * * * *', // Every 5 minutes for testing
            S3_PATH: 'scheduled-backups',
            LOG_LEVEL: 'info'
        };

        it('should initialize cron scheduler with correct configuration', async () => {
            // Arrange
            Object.assign(process.env, schedulingTestConfig);

            const nodeCron = require('node-cron');
            nodeCron.validate.mockReturnValue(true);

            let scheduledCallback: Function | undefined;
            nodeCron.schedule.mockImplementation((_expression: string, callback: Function) => {
                scheduledCallback = callback;
                return {
                    start: jest.fn(),
                    stop: jest.fn(),
                    destroy: jest.fn(),
                };
            });

            // Mock successful backup execution
            const mockPgDumpProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        setTimeout(() => callback(0), 50);
                    }
                }),
                kill: jest.fn(),
            } as any;

            mockSpawn.mockReturnValue(mockPgDumpProcess);

            mockS3Client.send.mockImplementation((command: any) => {
                const commandName = command.constructor.name;

                switch (commandName) {
                    case 'HeadBucketCommand':
                        return Promise.resolve({});
                    case 'PutObjectCommand':
                        return Promise.resolve({
                            ETag: '"test-etag"',
                            Location: `s3://${schedulingTestConfig.S3_BUCKET}/test-backup.sql.gz`
                        });
                    case 'ListObjectsV2Command':
                        return Promise.resolve({ Contents: [] });
                    default:
                        return Promise.resolve({});
                }
            });

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const postgresClient = new PostgreSQLClient(config.postgresConnectionString);
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);
            const backupManager = new BackupManager(postgresClient, s3Client, retentionManager, config);

            const cronScheduler = new CronScheduler(
                {
                    cronExpression: config.backupInterval,
                    timezone: 'UTC',
                    runOnInit: false
                },
                backupManager
            );

            cronScheduler.start();

            // Simulate cron trigger
            if (scheduledCallback) {
                await scheduledCallback();
            }

            // Assert
            expect(nodeCron.validate).toHaveBeenCalledWith(schedulingTestConfig.BACKUP_INTERVAL);
            expect(nodeCron.schedule).toHaveBeenCalledWith(
                schedulingTestConfig.BACKUP_INTERVAL,
                expect.any(Function),
                expect.objectContaining({
                    timezone: 'UTC'
                })
            );

            // Verify backup was executed
            expect(mockSpawn).toHaveBeenCalled();
            expect(mockS3Client.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: { name: 'PutObjectCommand' }
                })
            );
        });

        it('should prevent overlapping backup executions', async () => {
            // Arrange
            Object.assign(process.env, schedulingTestConfig);

            const nodeCron = require('node-cron');
            nodeCron.validate.mockReturnValue(true);

            let scheduledCallback: Function | undefined;
            nodeCron.schedule.mockImplementation((_expression: string, callback: Function) => {
                scheduledCallback = callback;
                return {
                    start: jest.fn(),
                    stop: jest.fn(),
                    destroy: jest.fn(),
                };
            });

            // Mock long-running backup process
            const mockPgDumpProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        // Simulate long-running process
                        setTimeout(() => callback(0), 2000);
                    }
                }),
                kill: jest.fn(),
            } as any;

            mockSpawn.mockReturnValue(mockPgDumpProcess);

            mockS3Client.send.mockImplementation((command: any) => {
                const commandName = command.constructor.name;

                switch (commandName) {
                    case 'HeadBucketCommand':
                        return Promise.resolve({});
                    case 'PutObjectCommand':
                        return Promise.resolve({
                            ETag: '"test-etag"',
                            Location: `s3://${schedulingTestConfig.S3_BUCKET}/test-backup.sql.gz`
                        });
                    case 'ListObjectsV2Command':
                        return Promise.resolve({ Contents: [] });
                    default:
                        return Promise.resolve({});
                }
            });

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const postgresClient = new PostgreSQLClient(config.postgresConnectionString);
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);
            const backupManager = new BackupManager(postgresClient, s3Client, retentionManager, config);

            const cronScheduler = new CronScheduler(
                {
                    cronExpression: config.backupInterval,
                    timezone: 'UTC',
                    runOnInit: false
                },
                backupManager
            );

            cronScheduler.start();

            // Trigger first backup (will be long-running)
            const firstBackup = scheduledCallback ? scheduledCallback() : Promise.resolve();

            // Trigger second backup while first is still running
            const secondBackup = scheduledCallback ? scheduledCallback() : Promise.resolve();

            await Promise.all([firstBackup, secondBackup]);

            // Assert
            // Should only execute one backup (no overlapping)
            expect(mockSpawn).toHaveBeenCalledTimes(1);
        }, 10000);
    });

    describe('Component Integration', () => {
        it('should integrate PostgreSQL client with backup manager', async () => {
            // Arrange
            const validConfig = {
                S3_BUCKET: 'test-integration-bucket',
                S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
                S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
                BACKUP_INTERVAL: '0 3 * * *',
                S3_PATH: 'integration-test',
                LOG_LEVEL: 'info'
            };

            Object.assign(process.env, validConfig);

            // Mock successful PostgreSQL connection test
            const mockPgProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        setTimeout(() => callback(0), 50);
                    }
                }),
                kill: jest.fn(),
            } as any;

            mockSpawn.mockReturnValue(mockPgProcess);

            // Mock successful S3 connection test
            mockS3Client.send.mockImplementation((command: any) => {
                if (command.constructor.name === 'HeadBucketCommand') {
                    return Promise.resolve({});
                }
                return Promise.resolve({});
            });

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const postgresClient = new PostgreSQLClient(config.postgresConnectionString);
            const s3Client = new S3Client(config);

            const pgConnected = await postgresClient.testConnection();
            const s3Connected = await s3Client.testConnection();

            // Assert
            expect(pgConnected).toBe(true);
            expect(s3Connected).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith(
                'psql',
                expect.arrayContaining([
                    '--no-password',
                    '--command=SELECT 1;',
                    validConfig.POSTGRES_CONNECTION_STRING
                ]),
                expect.any(Object)
            );
            expect(mockS3Client.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: { name: 'HeadBucketCommand' }
                })
            );
        });

        it('should integrate backup manager with all dependencies', async () => {
            // Arrange
            const validConfig = {
                S3_BUCKET: 'test-backup-integration',
                S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
                S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
                BACKUP_INTERVAL: '0 3 * * *',
                S3_PATH: 'backup-integration-test',
                LOG_LEVEL: 'info'
            };

            Object.assign(process.env, validConfig);

            // Mock successful connection tests
            mockS3Client.send.mockImplementation((command: any) => {
                if (command.constructor.name === 'HeadBucketCommand') {
                    return Promise.resolve({});
                }
                return Promise.resolve({});
            });

            const mockPgProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        setTimeout(() => callback(0), 50);
                    }
                }),
                kill: jest.fn(),
            } as any;

            mockSpawn.mockReturnValue(mockPgProcess);

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const postgresClient = new PostgreSQLClient(config.postgresConnectionString);
            const s3Client = new S3Client(config);
            const retentionManager = new RetentionManager(s3Client, config);
            const backupManager = new BackupManager(postgresClient, s3Client, retentionManager, config);

            const isValid = await backupManager.validateConfiguration();

            // Assert
            expect(isValid).toBe(true);
            expect(mockSpawn).toHaveBeenCalled(); // PostgreSQL connection test
            expect(mockS3Client.send).toHaveBeenCalled(); // S3 connection test
        });
    });

    describe('Environment Variable Handling', () => {
        it('should validate all required environment variables', () => {
            // Arrange - Missing all required variables
            // Act & Assert
            expect(() => ConfigurationManager.loadConfiguration())
                .toThrow(expect.objectContaining({
                    message: expect.stringContaining('Missing required environment variables')
                }));
        });

        it('should handle optional environment variables correctly', () => {
            // Arrange
            const minimalConfig = {
                S3_BUCKET: 'test-bucket',
                S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
                S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
                BACKUP_INTERVAL: '0 2 * * *'
            };

            Object.assign(process.env, minimalConfig);

            // Act
            const config = ConfigurationManager.loadConfiguration();

            // Assert
            expect(config.s3Bucket).toBe('test-bucket');
            expect(config.backupInterval).toBe('0 2 * * *');
            expect(config.s3Url).toBeUndefined();
            expect(config.s3Path).toBe('');
            expect(config.retentionDays).toBeUndefined();
            expect(config.logLevel).toBeUndefined();
        });

        it('should validate cron expression format', () => {
            // Arrange
            const configWithInvalidCron = {
                S3_BUCKET: 'test-bucket',
                S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
                S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                POSTGRES_CONNECTION_STRING: 'postgresql://testuser:testpass@localhost:5432/testdb',
                BACKUP_INTERVAL: 'not-a-cron-expression'
            };

            Object.assign(process.env, configWithInvalidCron);

            // Act & Assert
            expect(() => ConfigurationManager.loadConfiguration())
                .toThrow(expect.objectContaining({
                    message: expect.stringContaining('Invalid cron expression'),
                    field: 'BACKUP_INTERVAL'
                }));
        });

        it('should sanitize sensitive information in configuration logging', () => {
            // Arrange
            const configWithSensitiveData = {
                S3_BUCKET: 'test-bucket',
                S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
                S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                POSTGRES_CONNECTION_STRING: 'postgresql://testuser:secretpassword@localhost:5432/testdb',
                BACKUP_INTERVAL: '0 2 * * *'
            };

            Object.assign(process.env, configWithSensitiveData);

            // Act
            const config = ConfigurationManager.loadConfiguration();
            const sanitized = ConfigurationManager.sanitizeForLogging(config);

            // Assert
            expect(sanitized.s3AccessKey).toBe('AKIA***');
            expect(sanitized.postgresConnectionString).toBe('postgresql://testuser:***@localhost:5432/testdb');
            expect(sanitized.s3Bucket).toBe('test-bucket'); // Non-sensitive data preserved
        });
    });
});