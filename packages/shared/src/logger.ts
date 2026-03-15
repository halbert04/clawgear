const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function emit(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry = {
    level: level.toUpperCase(),
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  const json = JSON.stringify(entry);

  if (level === 'error' || level === 'fatal') {
    console.error(json);
  } else if (level === 'warn') {
    console.warn(json);
  } else {
    console.log(json);
  }
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
  fatal: (msg: string, extra?: Record<string, unknown>) => emit('fatal', msg, extra),
};
