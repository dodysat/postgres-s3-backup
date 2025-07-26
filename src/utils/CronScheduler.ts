import cron, { ScheduledTask } from 'node-cron';

export class CronScheduler {
  private cronExpression: string;
  private taskCallback: () => Promise<void>;
  private task: ScheduledTask | null = null;
  private running: boolean = false;
  private executing: boolean = false;

  constructor(cronExpression: string, taskCallback: () => Promise<void>) {
    if (!CronScheduler.isValidCron(cronExpression)) {
      throw new Error('Invalid cron expression');
    }
    this.cronExpression = cronExpression;
    this.taskCallback = taskCallback;
  }

  public start() {
    if (this.running) return;
    this.task = cron.schedule(
      this.cronExpression,
      async () => {
        if (this.executing) {
          console.log(
            '[CronScheduler] Previous job still running, skipping this execution.'
          );
          return;
        }
        this.executing = true;
        console.log('[CronScheduler] Scheduled job triggered.');
        try {
          await this.taskCallback();
        } catch (err) {
          console.error('[CronScheduler] Error during scheduled job:', err);
        } finally {
          this.executing = false;
        }
      },
      { scheduled: true }
    );
    this.running = true;
    console.log('[CronScheduler] Scheduler started.');
  }

  public stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      this.running = false;
      console.log('[CronScheduler] Scheduler stopped.');
    }
  }

  public isRunning() {
    return this.running;
  }

  public static isValidCron(expr: string): boolean {
    // node-cron supports 5 fields (no seconds)
    return cron.validate(expr);
  }
}
