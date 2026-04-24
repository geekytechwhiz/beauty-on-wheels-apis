import { logger } from '@api-hub/observability';

import type { BaseEvent, Middleware } from './types';

/**
 * Observes idempotency-related context for logs only. Does **not** block duplicates,
 * cache results, or persist processing state — that belongs in domain / use cases /
 * `event-platform` consumers.
 *
 * Place after `loggerMiddleware` so correlation flows from ALS.
 */
export function idempotencyMiddleware<
  TEvent extends BaseEvent,
  TResult,
  TContext = unknown,
>(options: {
  /** Shown in structured logs; domain code should use the same key for real idempotency. */
  getIdempotencyKey: (event: TEvent) => string;
  /**
   * When the domain (or a prior step) can signal duplicate, we log it. No return-value
   * short-circuiting — handlers still run unless domain logic exits early inside them.
   */
  isDuplicate?: (event: TEvent) => boolean | Promise<boolean>;
}): Middleware<TEvent, TResult, TContext> {
  const { getIdempotencyKey, isDuplicate } = options;

  return async ({ event, next }) => {
    const idempotencyKey = getIdempotencyKey(event as TEvent);

    let duplicate: boolean | undefined;
    if (isDuplicate) {
      duplicate = await isDuplicate(event as TEvent);
    }

    logger.info({
      event: 'idempotency_context',
      idempotencyKey,
      ...(duplicate !== undefined ? { duplicate } : {}),
    });

    return next();
  };
}
