type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel()];
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || !Object.keys(meta).length) {
    return '';
  }
  return ` ${JSON.stringify(meta)}`;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.debug(`[metadata-seed] ${message}${formatMeta(meta)}`);
    }
  },
  info(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.info(`[metadata-seed] ${message}${formatMeta(meta)}`);
    }
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.warn(`[metadata-seed] ${message}${formatMeta(meta)}`);
    }
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(`[metadata-seed] ${message}${formatMeta(meta)}`);
    }
  },
};
