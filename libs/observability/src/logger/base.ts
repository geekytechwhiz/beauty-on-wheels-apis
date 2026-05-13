import { Logger } from '@aws-lambda-powertools/logger';

let baseLogger: Logger;

export function getBaseLogger() {
  if (!baseLogger) {
    baseLogger = new Logger({
      serviceName: process.env.SERVICE_NAME || 'unknown-service',
      logLevel: (process.env.LOG_LEVEL as any) || 'ERROR',
    });
  }
  return baseLogger;
}

/** Powertools singleton for advanced use; prefer {@link createLogger} from `./structured-logger` (re-exported from package index). */
export function getPowertoolsLogger(): Logger {
  return getBaseLogger();
}