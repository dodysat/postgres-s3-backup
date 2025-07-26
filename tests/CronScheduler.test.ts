import {
  CronScheduler,
  CronSchedulerError,
  CronValidationError,
  CronExecutionError,
} from '../src/clients/CronScheduler';
import { CronSchedulerConfig } from '../src/interfaces/CronScheduler';
import { BackupManager, BackupResult } from '../src/interfaces/BackupManager';

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
  validate: jest.fn(),
}));

import * as cron from 'node-cron';

describe('CronScheduler', () => {
  let mockBackupManager: jest.Mocked<BackupManager>;
  let mockLogger: jest.Mocked<Console>;
  let mockTask: jest.Mocked<any>;
  let scheduler: CronScheduler;
  let config: CronSchedulerConfig;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock BackupManager
    mockBackupManager = {
      executeBackup: jest.fn(),
      validateConfiguration: jest.fn(),
    };

    // Mock Logger
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    // Mock scheduled task
    mockTask = {
      start: jest.fn(),
      stop: jest.fn(),
    };

    // Mock cron.schedule to return our mock task
    (cron.schedule as jest.Mock).mockReturnValue(mockTask);
    (cron.validate as jest.Mock).mockReturnValue(true);

    // Default config
    config = {
      cronExpression: '0 2 * * *', // Daily at 2 AM
      timezone: 'UTC',
    };

    scheduler = new CronScheduler(config, mockBackupManager, mockLogger);
  });

  describe('constructor', () => {
    it('should create scheduler with valid configuration', () => {
      expect(scheduler).toBeInstanceOf(CronScheduler);
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('validateCronExpression', () => {
    it('should validate correct cron expressions', () => {
      const validExpressions = [
        '0 2 * * *', // Daily at 2 AM
        '*/15 * * * *', // Every 15 minutes
        '0 0 1 * *', // First day of every month
        '0 9-17 * * 1-5', // Business hours on weekdays
      ];

      validExpressions.forEach(expr => {
        (cron.validate as jest.Mock).mockReturnValue(true);
        expect(scheduler.validateCronExpression(expr)).toBe(true);
        expect(cron.validate).toHaveBeenCalledWith(expr);
      });
    });

    it('should reject invalid cron expressions', () => {
      const invalidExpressions = [
        'invalid',
        '60 * * * *', // Invalid minute
        '* 25 * * *', // Invalid hour
        '* * 32 * *', // Invalid day
        '* * * 13 *', // Invalid month
      ];

      invalidExpressions.forEach(expr => {
        (cron.validate as jest.Mock).mockReturnValue(false);
        expect(scheduler.validateCronExpression(expr)).toBe(false);
        expect(cron.validate).toHaveBeenCalledWith(expr);
      });
    });

    it('should handle validation errors gracefully', () => {
      (cron.validate as jest.Mock).mockImplementation(() => {
        throw new Error('Validation error');
      });

      expect(scheduler.validateCronExpression('* * * * *')).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cron expression validation error:',
        'Validation error'
      );
    });
  });

  describe('start', () => {
    it('should start scheduler with valid cron expression', () => {
      scheduler.start();

      expect(cron.validate).toHaveBeenCalledWith(config.cronExpression);
      expect(cron.schedule).toHaveBeenCalledWith(config.cronExpression, expect.any(Function), {
        scheduled: false,
        timezone: 'UTC',
      });
      expect(mockTask.start).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Starting cron scheduler with expression: ${config.cronExpression}`
      );
      expect(mockLogger.log).toHaveBeenCalledWith('CronScheduler started successfully');
    });

    it('should throw error for invalid cron expression', () => {
      (cron.validate as jest.Mock).mockReturnValue(false);

      expect(() => scheduler.start()).toThrow('Invalid cron expression: 0 2 * * *');
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('should warn if already running', () => {
      scheduler.start();
      scheduler.start(); // Try to start again

      expect(mockLogger.warn).toHaveBeenCalledWith('CronScheduler is already running');
      expect(cron.schedule).toHaveBeenCalledTimes(1); // Should only be called once
    });

    it('should run initial backup if runOnInit is true', done => {
      const configWithRunOnInit = { ...config, runOnInit: true };
      const schedulerWithRunOnInit = new CronScheduler(
        configWithRunOnInit,
        mockBackupManager,
        mockLogger
      );

      const mockResult: BackupResult = {
        success: true,
        fileName: 'test-backup.sql.gz',
        fileSize: 1024,
        s3Location: 's3://bucket/test-backup.sql.gz',
        duration: 5000,
      };

      mockBackupManager.executeBackup.mockResolvedValue(mockResult);

      schedulerWithRunOnInit.start();

      // Use setImmediate to wait for the async initial backup
      setImmediate(() => {
        expect(mockLogger.log).toHaveBeenCalledWith(
          'Running initial backup due to runOnInit configuration'
        );
        done();
      });
    });

    it('should handle initial backup failure gracefully', done => {
      const configWithRunOnInit = { ...config, runOnInit: true };
      const schedulerWithRunOnInit = new CronScheduler(
        configWithRunOnInit,
        mockBackupManager,
        mockLogger
      );

      mockBackupManager.executeBackup.mockRejectedValue(new Error('Initial backup failed'));

      schedulerWithRunOnInit.start();

      // Use setTimeout to wait for the async initial backup error handling
      setTimeout(() => {
        // The error should be logged by the scheduled backup execution method
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Scheduled backup execution failed after')
        );
        done();
      }, 50);
    });
  });

  describe('stop', () => {
    it('should stop running scheduler', () => {
      scheduler.start();
      scheduler.stop();

      expect(mockTask.stop).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith('Stopping cron scheduler...');
      expect(mockLogger.log).toHaveBeenCalledWith('CronScheduler stopped successfully');
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should warn if not running', () => {
      scheduler.stop();

      expect(mockLogger.warn).toHaveBeenCalledWith('CronScheduler is not running');
      expect(mockTask.stop).not.toHaveBeenCalled();
    });
  });

  describe('isRunning', () => {
    it('should return false when not started', () => {
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should return true when running', () => {
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it('should return false after stopping', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('getNextScheduledTime', () => {
    it('should return null for invalid cron expression', () => {
      (cron.validate as jest.Mock).mockReturnValue(false);

      const result = scheduler.getNextScheduledTime();

      expect(result).toBeNull();
    });

    it('should return null and log warning for valid expression (node-cron limitation)', () => {
      const result = scheduler.getNextScheduledTime();

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'getNextScheduledTime: node-cron does not expose next execution time'
      );
    });
  });

  describe('scheduled backup execution', () => {
    let scheduledCallback: () => Promise<void>;

    beforeEach(() => {
      scheduler.start();
      // Get the callback function passed to cron.schedule
      scheduledCallback = (cron.schedule as jest.Mock).mock.calls[0][1];
    });

    it('should execute backup successfully', async () => {
      const mockResult: BackupResult = {
        success: true,
        fileName: 'postgres-backup-2023-10-01_02-00-00.sql.gz',
        fileSize: 2048576,
        s3Location: 's3://my-bucket/backups/postgres-backup-2023-10-01_02-00-00.sql.gz',
        duration: 15000,
      };

      mockBackupManager.executeBackup.mockResolvedValue(mockResult);

      await scheduledCallback();

      expect(mockBackupManager.executeBackup).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Starting scheduled backup at')
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Scheduled backup completed successfully')
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Backup execution completed, ready for next scheduled run'
      );
    });

    it('should handle backup failure gracefully', async () => {
      const mockResult: BackupResult = {
        success: false,
        fileName: '',
        fileSize: 0,
        s3Location: '',
        duration: 5000,
        error: 'Database connection failed',
      };

      mockBackupManager.executeBackup.mockResolvedValue(mockResult);

      await scheduledCallback();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Scheduled backup failed after')
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Backup execution completed, ready for next scheduled run'
      );
    });

    it('should handle backup execution exception', async () => {
      const error = new Error('Unexpected backup error');
      error.stack = 'Error stack trace';

      mockBackupManager.executeBackup.mockRejectedValue(error);

      await scheduledCallback();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Scheduled backup execution failed after')
      );
      expect(mockLogger.error).toHaveBeenCalledWith('Stack trace:', 'Error stack trace');
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Backup execution completed, ready for next scheduled run'
      );
    });

    it('should prevent overlapping backup executions', async () => {
      // Mock a long-running backup
      let resolveBackup: (result: BackupResult) => void;
      const backupPromise = new Promise<BackupResult>(resolve => {
        resolveBackup = resolve;
      });

      mockBackupManager.executeBackup.mockReturnValue(backupPromise);

      // Start first backup
      const firstBackup = scheduledCallback();

      // Try to start second backup while first is running
      await scheduledCallback();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Backup is already running, skipping this scheduled execution'
      );

      // Complete the first backup
      resolveBackup!({
        success: true,
        fileName: 'test.sql.gz',
        fileSize: 1024,
        s3Location: 's3://bucket/test.sql.gz',
        duration: 1000,
      });

      await firstBackup;

      // Verify only one backup was executed
      expect(mockBackupManager.executeBackup).toHaveBeenCalledTimes(1);
    });

    it('should handle error without stack trace', async () => {
      const error = 'String error without stack';

      mockBackupManager.executeBackup.mockRejectedValue(error);

      await scheduledCallback();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Scheduled backup execution failed after')
      );
      // Should not try to log stack trace for non-Error objects
      expect(mockLogger.error).not.toHaveBeenCalledWith('Stack trace:', expect.anything());
    });
  });

  describe('enhanced error handling and recovery', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe('start method error handling', () => {
      it('should throw CronValidationError for invalid cron expression', () => {
        (cron.validate as jest.Mock).mockReturnValue(false);

        expect(() => scheduler.start()).toThrow(CronValidationError);
        expect(() => scheduler.start()).toThrow('Invalid cron expression: 0 2 * * *');
      });

      it('should throw CronSchedulerError for unexpected start failures', () => {
        (cron.schedule as jest.Mock).mockImplementation(() => {
          throw new Error('Unexpected scheduling error');
        });

        expect(() => scheduler.start()).toThrow(CronSchedulerError);
        expect(() => scheduler.start()).toThrow('Failed to start cron scheduler');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to start cron scheduler')
        );
      });

      it('should log timezone information on start', () => {
        scheduler.start();

        expect(mockLogger.log).toHaveBeenCalledWith(
          'Starting cron scheduler with expression: 0 2 * * * (timezone: UTC)'
        );
      });
    });

    describe('scheduled execution error handling', () => {
      let scheduledCallback: () => Promise<void>;

      beforeEach(() => {
        scheduler.start();
        scheduledCallback = (cron.schedule as jest.Mock).mock.calls[0][1];
      });

      it('should handle backup execution timeout', async () => {
        // Mock a backup that never resolves
        const neverResolvingPromise = new Promise(() => {});
        mockBackupManager.executeBackup.mockReturnValue(
          neverResolvingPromise as Promise<BackupResult>
        );

        const executionPromise = scheduledCallback();

        // Fast-forward past the timeout (1 hour)
        jest.advanceTimersByTime(60 * 60 * 1000 + 1000);

        await executionPromise;

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Backup execution timed out after 3600000ms')
        );
      });

      it('should generate unique execution IDs for tracking', async () => {
        const mockResult: BackupResult = {
          success: true,
          fileName: 'test.sql.gz',
          fileSize: 1024,
          s3Location: 's3://bucket/test.sql.gz',
          duration: 1000,
        };

        mockBackupManager.executeBackup.mockResolvedValue(mockResult);

        await scheduledCallback();
        await scheduledCallback();

        const logCalls = mockLogger.log.mock.calls;
        const executionIdCalls = logCalls.filter(
          call =>
            call[0] && call[0].includes('[cron-') && call[0].includes('Starting scheduled backup')
        );

        expect(executionIdCalls.length).toBe(2);

        // Extract execution IDs and verify they're different
        const executionId1 = executionIdCalls[0][0].match(/\[([^\]]+)\]/)?.[1];
        const executionId2 = executionIdCalls[1][0].match(/\[([^\]]+)\]/)?.[1];

        expect(executionId1).toBeDefined();
        expect(executionId2).toBeDefined();
        expect(executionId1).not.toBe(executionId2);
      });

      it('should log execution context on errors', async () => {
        const error = new Error('Backup execution failed');
        mockBackupManager.executeBackup.mockRejectedValue(error);

        await scheduledCallback();

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Execution context:'),
          expect.objectContaining({
            cronExpression: '0 2 * * *',
            timezone: 'UTC',
          })
        );
      });

      it('should handle unexpected errors in scheduled callback wrapper', async () => {
        // Mock cron.schedule to call our callback wrapper
        const callbackWrapper = jest.fn().mockImplementation(async () => {
          throw new Error('Unexpected wrapper error');
        });

        (cron.schedule as jest.Mock).mockImplementation((_expr, _callback) => {
          // Replace the callback with our wrapper that throws
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          _callback = callbackWrapper;
          return mockTask;
        });

        const errorScheduler = new CronScheduler(config, mockBackupManager, mockLogger);
        errorScheduler.start();

        const wrappedCallback = (cron.schedule as jest.Mock).mock.calls[0][1];
        await wrappedCallback();

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Unexpected error in scheduled backup execution')
        );
      });

      it('should format different error types consistently', async () => {
        const testCases = [
          { error: new Error('Standard error'), expected: 'Error: Standard error' },
          { error: 'String error', expected: 'String error' },
          { error: { message: 'Object error' }, expected: '[object Object]' },
          { error: null, expected: 'null' },
          { error: undefined, expected: 'undefined' },
        ];

        for (const testCase of testCases) {
          mockBackupManager.executeBackup.mockRejectedValue(testCase.error);
          await scheduledCallback();

          expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining(testCase.expected));

          jest.clearAllMocks();
        }
      });

      it('should handle backup manager returning race condition winner', async () => {
        // Test that Promise.race works correctly with timeout
        const quickResult: BackupResult = {
          success: true,
          fileName: 'quick-backup.sql.gz',
          fileSize: 1024,
          s3Location: 's3://bucket/quick-backup.sql.gz',
          duration: 100,
        };

        mockBackupManager.executeBackup.mockResolvedValue(quickResult);

        await scheduledCallback();

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Scheduled backup completed successfully')
        );
        expect(mockLogger.log).not.toHaveBeenCalledWith(expect.stringContaining('timed out'));
      });
    });

    describe('error recovery and resilience', () => {
      it('should continue scheduling after backup failures', async () => {
        scheduler.start();
        const scheduledCallback = (cron.schedule as jest.Mock).mock.calls[0][1];

        // First execution fails
        mockBackupManager.executeBackup.mockRejectedValueOnce(new Error('First failure'));
        await scheduledCallback();

        // Second execution succeeds
        const successResult: BackupResult = {
          success: true,
          fileName: 'recovery-backup.sql.gz',
          fileSize: 1024,
          s3Location: 's3://bucket/recovery-backup.sql.gz',
          duration: 1000,
        };
        mockBackupManager.executeBackup.mockResolvedValueOnce(successResult);
        await scheduledCallback();

        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('First failure'));
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Scheduled backup completed successfully')
        );
      });

      it('should reset backup running flag after errors', async () => {
        scheduler.start();
        const scheduledCallback = (cron.schedule as jest.Mock).mock.calls[0][1];

        // First execution fails
        mockBackupManager.executeBackup.mockRejectedValue(new Error('Backup failed'));
        await scheduledCallback();

        // Second execution should not be skipped due to "already running"
        mockBackupManager.executeBackup.mockResolvedValue({
          success: true,
          fileName: 'test.sql.gz',
          fileSize: 1024,
          s3Location: 's3://bucket/test.sql.gz',
          duration: 1000,
        });
        await scheduledCallback();

        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          'Backup is already running, skipping this scheduled execution'
        );
      });
    });
  });

  describe('custom error types', () => {
    it('should create CronSchedulerError with proper properties', () => {
      const cause = new Error('Original error');
      const cronError = new CronSchedulerError('Scheduler failed', 'test_operation', cause);

      expect(cronError.name).toBe('CronSchedulerError');
      expect(cronError.message).toBe('Scheduler failed');
      expect(cronError.operation).toBe('test_operation');
      expect(cronError.cause).toBe(cause);
      expect(cronError.stack).toContain('Caused by:');
    });

    it('should create CronValidationError with proper properties', () => {
      const validationError = new CronValidationError('Invalid expression', '* * * *');

      expect(validationError.name).toBe('CronValidationError');
      expect(validationError.message).toBe('Invalid expression');
      expect(validationError.operation).toBe('validation');
      expect(validationError.expression).toBe('* * * *');
    });

    it('should create CronExecutionError with proper properties', () => {
      const cause = new Error('Execution failed');
      const executionError = new CronExecutionError('Cannot execute backup', cause);

      expect(executionError.name).toBe('CronExecutionError');
      expect(executionError.message).toBe('Cannot execute backup');
      expect(executionError.operation).toBe('execution');
      expect(executionError.cause).toBe(cause);
    });
  });

  describe('timezone handling', () => {
    it('should use custom timezone when provided', () => {
      const customConfig = {
        ...config,
        timezone: 'America/New_York',
      };

      const customScheduler = new CronScheduler(customConfig, mockBackupManager, mockLogger);
      customScheduler.start();

      expect(cron.schedule).toHaveBeenCalledWith(
        customConfig.cronExpression,
        expect.any(Function),
        {
          scheduled: false,
          timezone: 'America/New_York',
        }
      );
    });

    it('should default to UTC when timezone not provided', () => {
      const configWithoutTimezone = {
        cronExpression: '0 2 * * *',
      };

      const schedulerWithoutTimezone = new CronScheduler(
        configWithoutTimezone,
        mockBackupManager,
        mockLogger
      );
      schedulerWithoutTimezone.start();

      expect(cron.schedule).toHaveBeenCalledWith(
        configWithoutTimezone.cronExpression,
        expect.any(Function),
        {
          scheduled: false,
          timezone: 'UTC',
        }
      );
    });
  });
});
