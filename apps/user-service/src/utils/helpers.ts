import { randomUUID } from 'crypto';

export const getCorrelationId = (headers: Record<string, string | undefined>): string =>
  headers['x-correlation-id'] || headers['X-Correlation-ID'] || randomUUID();

export const generateFileId = (): string => randomUUID();

