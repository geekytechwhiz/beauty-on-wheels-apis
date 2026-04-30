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

/** Powertools singleton; accepts structured objects on `.info`/`.warn` like AWS Lambda Powertools Logger. */
export function createLogger(): Logger {
  return getBaseLogger();
}