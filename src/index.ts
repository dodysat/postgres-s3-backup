import { ConfigurationManager, ConfigurationError } from './config/ConfigurationManager';
import { Logger } from './clients/Logger';
import { BackupManager } from './clients/BackupManager';
import { CronScheduler } from './clients/CronScheduler';
import { PostgreSQLClient } from './clients/PostgreSQLClient';
import { S3Client } from './clients/S3Client';
import { RetentionManager } from './clients/RetentionManager';
import { BackupConfig } from './interfaces/BackupConfig';
import { LogLevel } from './interfaces/Logger';

/**
 * Main application class that initializes and coordinates all components
 */
class PostgreSQLBackupApplication {
  private logger: Logger;
  private config: BackupConfig;
  private cronScheduler: CronScheduler | null = null;
  private isShuttingDown = false;

  constructor() {
    // Initialize logger first (will be reconfigured after loading config)
    this.logger = new Logger(LogLevel.INFO);
    this.config = {} as BackupConfig; // Will be loaded in initialize()
  }

  /**
   * Initialize the application with configuration and component setup
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('PostgreSQL S3 Backup Service starting...');

      // Load and validate configuration
      this.config = ConfigurationManager.loadConfiguration();

      // Reconfigure logger with proper log level
      if (this.config.logLevel) {
        this.logger = new Logger(this.config.logLevel as LogLevel);
      }

      // Log sanitized configuration
      this.logger.logConfigurationStart(ConfigurationManager.sanitizeForLogging(this.config));

      // Initialize components
      const postgresClient = new PostgreSQLClient(this.config.postgresConnectionString);
      const s3Client = new S3Client(this.config);
      const retentionManager = new RetentionManager(s3Client, this.config);
      const backupManager = new BackupManager(
        postgresClient,
        s3Client,
        retentionManager,
        this.config
      );

      // Validate configuration by testing connections
      this.logger.info('Validating configuration and testing connections...');
      const isValid = await backupManager.validateConfiguration();

      if (!isValid) {
        throw new Error('Configuration validation failed');
      }

      this.logger.info('Configuration validation completed successfully');

      // Initialize cron scheduler
      this.cronScheduler = new CronScheduler(
        {
          cronExpression: this.config.backupInterval,
          timezone: 'UTC',
          runOnInit: false, // Don't run backup immediately on startup
        },
        backupManager
        // Use default console logger for CronScheduler
      );

      this.logger.info('Application initialized successfully');
    } catch (error) {
      if (error instanceof ConfigurationError) {
        this.logger.error('Configuration error', error);
        process.exit(1);
      } else {
        this.logger.error('Failed to initialize application', error as Error);
        process.exit(2);
      }
    }
  }

  /**
   * Start the application and begin scheduled backups
   */
  async start(): Promise<void> {
    try {
      if (!this.cronScheduler) {
        throw new Error('Application not initialized. Call initialize() first.');
      }

      this.logger.info(`Starting backup scheduler with interval: ${this.config.backupInterval}`);
      this.cronScheduler.start();

      this.logger.info('PostgreSQL S3 Backup Service started successfully');
      this.logger.info(
        'Service is now running and will execute backups according to the configured schedule'
      );
    } catch (error) {
      this.logger.error('Failed to start application', error as Error);
      process.exit(3);
    }
  }

  /**
   * Gracefully shutdown the application
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Initiating graceful shutdown...');

    try {
      // Stop the cron scheduler
      if (this.cronScheduler && this.cronScheduler.isRunning()) {
        this.logger.info('Stopping backup scheduler...');
        this.cronScheduler.stop();
        this.logger.info('Backup scheduler stopped');
      }

      // Wait a moment for any ongoing operations to complete
      await this.sleep(2000);

      this.logger.info('PostgreSQL S3 Backup Service shutdown completed');
    } catch (error) {
      this.logger.error('Error during shutdown', error as Error);
      process.exit(4);
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers(): void {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'] as const;

    signals.forEach(signal => {
      process.on(signal, async () => {
        this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
        await this.shutdown();
        process.exit(0);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', error => {
      this.logger.error('Uncaught exception', error);
      this.shutdown().finally(() => process.exit(5));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled promise rejection', new Error(String(reason)), {
        promise: promise.toString(),
      });
      this.shutdown().finally(() => process.exit(6));
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  const app = new PostgreSQLBackupApplication();

  // Setup signal handlers for graceful shutdown
  app.setupSignalHandlers();

  // Initialize and start the application
  await app.initialize();
  await app.start();

  // Keep the process running
  process.stdin.resume();
}

// Export for testing
export { PostgreSQLBackupApplication, main };

// Start the application
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error starting application:', error);
    process.exit(7);
  });
}
