import { ConfigurationManager } from './config/ConfigurationManager';
import { BackupManagerImpl } from './backup/BackupManager';
import { CronScheduler } from './utils/CronScheduler';
import { Logger } from './utils/Logger';

class Application {
  private configManager: ConfigurationManager;
  private backupManager!: BackupManagerImpl;
  private scheduler: CronScheduler | null = null;
  private isShuttingDown = false;

  constructor() {
    this.configManager = new ConfigurationManager();
  }

  public async start(): Promise<void> {
    try {
      Logger.info('Starting PostgreSQL S3 Backup application...');

      // Load and validate configuration
      const config = this.configManager.getConfig();
      Logger.info(
        'Configuration loaded successfully',
        this.configManager.getSanitizedConfig()
      );

      // Initialize backup manager
      this.backupManager = new BackupManagerImpl(config);
      if (!this.backupManager.validateConfiguration()) {
        throw new Error('Invalid backup configuration');
      }

      // Test connections
      Logger.info('Testing database and S3 connections...');
      const backupResult = await this.backupManager.executeBackup();
      if (!backupResult.success) {
        throw new Error(`Initial backup test failed: ${backupResult.error}`);
      }
      Logger.info('Initial backup test completed successfully', {
        fileName: backupResult.fileName,
        fileSize: backupResult.fileSize,
        duration: backupResult.duration,
      });

      // Start cron scheduler
      this.scheduler = new CronScheduler(config.backupInterval, async () => {
        if (this.isShuttingDown) return;
        Logger.info('Scheduled backup started');
        const result = await this.backupManager.executeBackup();
        if (result.success) {
          Logger.info('Scheduled backup completed successfully', {
            fileName: result.fileName,
            fileSize: result.fileSize,
            duration: result.duration,
          });
        } else {
          Logger.error('Scheduled backup failed', { error: result.error });
        }
      });

      this.scheduler.start();
      Logger.info('Cron scheduler started', {
        interval: config.backupInterval,
      });

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      Logger.info('Application started successfully');
    } catch (error) {
      Logger.error('Failed to start application', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      Logger.info(`Received ${signal}, starting graceful shutdown...`);

      if (this.scheduler) {
        this.scheduler.stop();
        Logger.info('Cron scheduler stopped');
      }

      Logger.info('Application shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Start the application
const app = new Application();
app.start().catch((error) => {
  Logger.error('Unhandled error during startup', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
