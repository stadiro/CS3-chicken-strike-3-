export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

const threshold = LEVEL_WEIGHT[resolveLevel()];

function write(level: LogLevel, message: string, context?: unknown): void {
  if (LEVEL_WEIGHT[level] < threshold) {
    return;
  }

  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const log =
    level === 'debug'
      ? console.log
      : level === 'info'
        ? console.info
        : level === 'warn'
          ? console.warn
          : console.error;

  if (context === undefined) {
    log(line);
  } else {
    log(line, context);
  }
}

export const logger = {
  debug: (message: string, context?: unknown): void => write('debug', message, context),
  info: (message: string, context?: unknown): void => write('info', message, context),
  warn: (message: string, context?: unknown): void => write('warn', message, context),
  error: (message: string, context?: unknown): void => write('error', message, context),
};
