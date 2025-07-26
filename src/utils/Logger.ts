import winston from 'winston';

const SENSITIVE_KEYS = [
  's3AccessKey',
  's3SecretKey',
  'postgresConnectionString',
  'password',
  'secret',
];

function redactSensitive(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(clone)) {
    if (SENSITIVE_KEYS.includes(key)) {
      clone[key] = '[REDACTED]';
    } else if (typeof clone[key] === 'object') {
      clone[key] = redactSensitive(clone[key]);
    }
  }
  return clone;
}

export class Logger {
  private static instance: winston.Logger;

  private constructor() {}

  public static getLogger(level: string = 'info'): winston.Logger {
    if (!Logger.instance) {
      Logger.instance = winston.createLogger({
        level,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            let logObj = meta;
            if (typeof message === 'object') {
              logObj = { ...logObj, ...redactSensitive(message) };
              message = undefined;
            }
            return JSON.stringify({
              timestamp,
              level,
              message: typeof message === 'string' ? message : undefined,
              ...redactSensitive(logObj),
            });
          })
        ),
        transports: [new winston.transports.Console()],
      });
    }
    return Logger.instance;
  }

  public static info(msg: any, meta?: any) {
    Logger.getLogger().info(msg, meta);
  }
  public static warn(msg: any, meta?: any) {
    Logger.getLogger().warn(msg, meta);
  }
  public static error(msg: any, meta?: any) {
    Logger.getLogger().error(msg, meta);
  }
  public static debug(msg: any, meta?: any) {
    Logger.getLogger().debug(msg, meta);
  }
}
