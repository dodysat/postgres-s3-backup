import { PostgreSQLBackupApplication } from '../src/index';
import { ConfigurationManager, ConfigurationError } from '../src/config/ConfigurationManager';
import { Logger } from '../src/clients/Logger';
import { BackupManager } from '../src/clients/BackupManager';
import { CronScheduler } from '../src/clients/CronScheduler';
import { PostgreSQLClient } from '../src/clients/PostgreSQLClient';
import { S3Client } from '../src/clients/S3Client';
import { RetentionManager } from '../src/clients/RetentionManager';

// Mock all dependencies
jest.mock('../src/config/ConfigurationManager');
jest.mock('../src/clients/Logger');
jest.mock('../src/clients/BackupManager');
jest.mock('../src/clients/CronScheduler');
jest.mock('../src/clients/PostgreSQLClient');
jest.mock('../src/clients/S3Client');
jest.mock('../src/clients/RetentionManager');

describe('PostgreSQLBackupApplication', () => {
  let app: PostgreSQLBackupApplication;
  let mockConfigurationManager: jest.Mocked<typeof ConfigurationManager>;
  let mockLogger: jest.Mocked<Logger>;
  let mockBackupManager: jest.Mocked<BackupManager>;
  let mockCronScheduler: jest.Mocked<CronScheduler>;
  let mockPostgresClient: jest.Mocked<PostgreSQLClient>;
  let mockS3Client: jest.Mocked<S3Client>;
  let mockRetentionManager: jest.Mocked<RetentionManager>;

  const mockConfig = {
    s3Bucket: 'test-bucket',
    s3AccessKey: 'test-access-key',
    s3SecretKey: 'test-secret-key',
    postgresConnectionString: 'postgresql://user:pass@localhost:5432/testdb',
    backupInterval: '0 2 * * *',
    s3Path: 'backups',
    retentionDays: 30,
    logLevel: 'info'
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Setup mocks
    mockConfigurationManager = ConfigurationManager as jest.Mocked<typeof ConfigurationManager>;
    mockLogger = new Logger() as jest.Mocked<Logger>;
    mockBackupManager = new BackupManager({} as any, {} as any, {} as any, {} as any) as jest.Mocked<BackupManager>;
    mockCronScheduler = new CronScheduler({} as any, {} as any) as jest.Mocked<CronScheduler>;
    mockPostgresClient = new PostgreSQLClient('') as jest.Mocked<PostgreSQLClient>;
    mockS3Client = new S3Client({} as any) as jest.Mocked<S3Client>;
    mockRetentionManager = new RetentionManager({} as any, {} as any) as jest.Mocked<RetentionManager>;

    // Setup default mock implementations
    mockConfigurationManager.loadConfiguration.mockReturnValue(mockConfig);
    mockConfigurationManager.sanitizeForLogging.mockReturnValue({
      s3Bucket: 'test-bucket',
      s3Path: 'backups',
      backupInterval: '0 2 * * *'
    });

    mockBackupManager.validateConfiguration.mockResolvedValue(true);
    mockCronScheduler.isRunning.mockReturnValue(true);

    // Mock constructors
    (Logger as jest.MockedClass<typeof Logger>).mockImplementation(() => mockLogger);
    (BackupManager as jest.MockedClass<typeof BackupManager>).mockImplementation(() => mockBackupManager);
    (CronScheduler as jest.MockedClass<typeof CronScheduler>).mockImplementation(() => mockCronScheduler);
    (PostgreSQLClient as jest.MockedClass<typeof PostgreSQLClient>).mockImplementation(() => mockPostgresClient);
    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(() => mockS3Client);
    (RetentionManager as jest.MockedClass<typeof RetentionManager>).mockImplementation(() => mockRetentionManager);

    app = new PostgreSQLBackupApplication();
  });

  describe('initialize', () => {
    it('should successfully initialize with valid configuration', async () => {
      await app.initialize();

      expect(mockConfigurationManager.loadConfiguration).toHaveBeenCalled();
      expect(mockConfigurationManager.sanitizeForLogging).toHaveBeenCalledWith(mockConfig);
      expect(mockLogger.logConfigurationStart).toHaveBeenCalled();
      expect(mockBackupManager.validateConfiguration).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Application initialized successfully');
    });

    it('should exit with code 1 on configuration error', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      mockConfigurationManager.loadConfiguration.mockImplementation(() => {
        throw new ConfigurationError('Missing required environment variable: S3_BUCKET');
      });

      await expect(app.initialize()).rejects.toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Configuration error',
        expect.any(ConfigurationError)
      );

      mockExit.mockRestore();
    });

    it('should exit with code 2 on general initialization error', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      mockBackupManager.validateConfiguration.mockRejectedValue(new Error('Connection failed'));

      await expect(app.initialize()).rejects.toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize application',
        expect.any(Error)
      );

      mockExit.mockRestore();
    });

    it('should exit with code 2 when configuration validation fails', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      mockBackupManager.validateConfiguration.mockResolvedValue(false);

      await expect(app.initialize()).rejects.toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(2);

      mockExit.mockRestore();
    });

    it('should create logger with custom log level from config', async () => {
      const configWithLogLevel = { ...mockConfig, logLevel: 'debug' };
      mockConfigurationManager.loadConfiguration.mockReturnValue(configWithLogLevel);

      await app.initialize();

      // Verify Logger constructor was called with debug log level
      expect(Logger).toHaveBeenCalledWith('debug');
    });
  });

  describe('start', () => {
    beforeEach(async () => {
      await app.initialize();
    });

    it('should successfully start the application', async () => {
      await app.start();

      expect(mockCronScheduler.start).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting backup scheduler with interval: 0 2 * * *'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'PostgreSQL S3 Backup Service started successfully'
      );
    });

    it('should exit with code 3 on start failure', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      mockCronScheduler.start.mockImplementation(() => {
        throw new Error('Failed to start scheduler');
      });

      await expect(app.start()).rejects.toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(3);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to start application',
        expect.any(Error)
      );

      mockExit.mockRestore();
    });

    it('should throw error if not initialized', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit called with code ${code}`);
      });

      const uninitializedApp = new PostgreSQLBackupApplication();

      try {
        await expect(uninitializedApp.start()).rejects.toThrow('process.exit called with code 3');
        expect(mockExit).toHaveBeenCalledWith(3);
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await app.initialize();
      await app.start();
    });

    it('should gracefully shutdown the application', async () => {
      await app.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith('Initiating graceful shutdown...');
      expect(mockCronScheduler.stop).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('PostgreSQL S3 Backup Service shutdown completed');
    });

    it('should handle shutdown when scheduler is not running', async () => {
      mockCronScheduler.isRunning.mockReturnValue(false);

      await app.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith('Initiating graceful shutdown...');
      expect(mockCronScheduler.stop).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('PostgreSQL S3 Backup Service shutdown completed');
    });

    it('should handle multiple shutdown calls', async () => {
      await app.shutdown();
      await app.shutdown(); // Second call

      expect(mockLogger.warn).toHaveBeenCalledWith('Shutdown already in progress');
    });

    it('should exit with code 4 on shutdown error', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      mockCronScheduler.stop.mockImplementation(() => {
        throw new Error('Failed to stop scheduler');
      });

      await expect(app.shutdown()).rejects.toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(4);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during shutdown',
        expect.any(Error)
      );

      mockExit.mockRestore();
    });
  });

  describe('setupSignalHandlers', () => {
    let mockProcessOn: jest.SpyInstance;

    beforeEach(async () => {
      mockProcessOn = jest.spyOn(process, 'on').mockImplementation(() => process);
      await app.initialize();
    });

    afterEach(() => {
      mockProcessOn.mockRestore();
    });

    it('should setup signal handlers for graceful shutdown', () => {
      app.setupSignalHandlers();

      expect(mockProcessOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('SIGUSR2', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    });
  });
});

describe('Integration Tests', () => {
  let mockProcessStdinResume: jest.SpyInstance;
  let mockConsoleError: jest.SpyInstance;
  let mockProcessExit: jest.SpyInstance;

  const mockConfig = {
    s3Bucket: 'test-bucket',
    s3AccessKey: 'test-access-key',
    s3SecretKey: 'test-secret-key',
    postgresConnectionString: 'postgresql://user:pass@localhost:5432/testdb',
    backupInterval: '0 2 * * *',
    s3Path: 'backups',
    retentionDays: 30,
    logLevel: 'info'
  };

  beforeEach(() => {
    // Mock process methods
    mockProcessStdinResume = jest.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    mockProcessExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Setup default mock implementations
    (ConfigurationManager as jest.Mocked<typeof ConfigurationManager>).loadConfiguration.mockReturnValue(mockConfig);
    (ConfigurationManager as jest.Mocked<typeof ConfigurationManager>).sanitizeForLogging.mockReturnValue({
      s3Bucket: 'test-bucket',
      s3Path: 'backups',
      backupInterval: '0 2 * * *'
    });
    
    // Mock BackupManager prototype method
    BackupManager.prototype.validateConfiguration = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    mockProcessStdinResume.mockRestore();
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  it('should handle main function execution with mocked dependencies', async () => {
    const { main } = require('../src/index');
    
    await main();

    expect(mockProcessStdinResume).toHaveBeenCalled();
  });

  it('should test complete application startup flow', async () => {
    // Test that the application can be created and initialized without errors
    const app = new PostgreSQLBackupApplication();
    
    // Should not throw during construction
    expect(app).toBeInstanceOf(PostgreSQLBackupApplication);
    
    // Setup signal handlers should not throw
    expect(() => app.setupSignalHandlers()).not.toThrow();
  });

  it('should handle errors during main function execution', async () => {
    // Mock configuration to fail
    (ConfigurationManager as jest.Mocked<typeof ConfigurationManager>).loadConfiguration.mockImplementation(() => {
      throw new ConfigurationError('Missing required environment variable: S3_BUCKET');
    });

    const { main } = require('../src/index');

    await expect(main()).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalled();
  });

  it('should export main function and PostgreSQLBackupApplication class', () => {
    const { main, PostgreSQLBackupApplication } = require('../src/index');
    
    expect(typeof main).toBe('function');
    expect(typeof PostgreSQLBackupApplication).toBe('function');
  });
});