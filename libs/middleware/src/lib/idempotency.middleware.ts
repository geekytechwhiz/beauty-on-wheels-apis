// idempotencyMiddleware.ts

import { logger } from '@api-hub/observability';

export const idempotencyMiddleware = ({
  getKey,
  store,
}: {
  getKey: (event: any) => string;
  store: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
  };
}) => {
  return async ({ event, next }: any) => {
    const key = getKey(event);

    // Check existing
    const existing = await store.get(key);

    if (existing) {
      logger.info({
        event: 'idempotency_hit',
        idempotencyKey: key,
      });

      return existing;
    }

    try {
      const result = await next();

      await store.set(key, result);

      logger.info({
        event: 'idempotency_stored',
        idempotencyKey: key,
      });

      return result;
    } catch (error) {
      logger.error({
        event: 'idempotency_failed',
        idempotencyKey: key,
        error,
      });

      throw error;
    }
  };
};