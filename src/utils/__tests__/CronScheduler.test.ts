import { CronScheduler } from '../CronScheduler';
import cron from 'node-cron';

jest.mock('node-cron');

describe('CronScheduler', () => {
  let callback: jest.Mock;
  let scheduleMock: jest.Mock;
  let scheduledTask: { stop: jest.Mock };

  beforeEach(() => {
    callback = jest.fn().mockResolvedValue(undefined);
    scheduledTask = { stop: jest.fn() };
    scheduleMock = jest.fn().mockReturnValue(scheduledTask);
    (cron.schedule as jest.Mock) = scheduleMock;
    (cron.validate as jest.Mock) = jest.fn((expr) => expr === '0 2 * * *');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('validates cron expressions', () => {
    expect(CronScheduler.isValidCron('0 2 * * *')).toBe(true);
    expect(CronScheduler.isValidCron('bad cron')).toBe(false);
  });

  it('throws on invalid cron expression', () => {
    expect(() => new CronScheduler('bad cron', callback)).toThrow(
      'Invalid cron expression'
    );
  });

  it('starts and stops the scheduler', () => {
    const scheduler = new CronScheduler('0 2 * * *', callback);
    scheduler.start();
    expect(scheduleMock).toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduledTask.stop).toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('calls the callback on schedule', async () => {
    let scheduledFn: any;
    scheduleMock.mockImplementation((_, fn) => {
      scheduledFn = fn;
      return scheduledTask;
    });
    const scheduler = new CronScheduler('0 2 * * *', callback);
    scheduler.start();
    await scheduledFn();
    expect(callback).toHaveBeenCalled();
  });

  it('prevents overlapping executions', async () => {
    let scheduledFn: any;
    scheduleMock.mockImplementation((_, fn) => {
      scheduledFn = fn;
      return scheduledTask;
    });
    const scheduler = new CronScheduler('0 2 * * *', callback);
    scheduler.start();
    // Simulate first call in progress
    callback.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
    const p1 = scheduledFn();
    const p2 = scheduledFn();
    await p1;
    await p2;
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
