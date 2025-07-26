import { Logger } from '../Logger';
import winston from 'winston';

describe('Logger', () => {
  let logSpy: jest.SpyInstance;
  let output: string[];

  beforeEach(() => {
    output = [];
    logSpy = jest
      .spyOn(winston.transports.Console.prototype as any, 'log')
      .mockImplementation((info: any, next: any) => {
        output.push(info[Symbol.for('message')]);
        next && next();
      });
    // Reset singleton
    (Logger as any).instance = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs info, warn, error, debug', () => {
    Logger.getLogger('debug'); // Set level to debug for this test
    Logger.info('info message');
    Logger.warn('warn message');
    Logger.error('error message');
    Logger.debug('debug message');
    expect(output.length).toBe(4);
    const logs = output.map((line) => JSON.parse(line as string));
    expect(logs[0].level).toBe('info');
    expect(logs[1].level).toBe('warn');
    expect(logs[2].level).toBe('error');
    expect(logs[3].level).toBe('debug');
  });

  it('redacts sensitive fields', () => {
    Logger.info({
      s3AccessKey: 'secret',
      nested: { postgresConnectionString: 'pg' },
    });
    const log = JSON.parse(output[0] as string);
    expect(log.s3AccessKey).toBe('[REDACTED]');
    expect(log.nested.postgresConnectionString).toBe('[REDACTED]');
  });

  it('outputs JSON', () => {
    Logger.info('json test', { foo: 'bar' });
    const log = JSON.parse(output[0] as string);
    expect(log.level).toBe('info');
    expect(log.message).toBe('json test');
    expect(log.foo).toBe('bar');
    expect(typeof log.timestamp).toBe('string');
  });
});
