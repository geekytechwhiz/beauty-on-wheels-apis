import { Logger } from '@aws-lambda-powertools/logger';

export const logger = new Logger({
  serviceName: 'Mvtrx-email-service',
  logLevel: (process.env.LOG_LEVEL || 'INFO') as any,
});
