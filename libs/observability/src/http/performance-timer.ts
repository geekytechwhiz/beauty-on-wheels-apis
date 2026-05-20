import { getLogger } from '../logger/logger';

function createTimer(operation: string, correlationId?: string): {
  end: () => void;
} {
  const startTime = Date.now();
  return {
    end: () => {
      const duration = Date.now() - startTime;
      getLogger().info('performance_timer', {
        operation,
        duration,
        correlationId,
      });
    },
  };
}

/**
 * Simple duration logger aligned with legacy `@api-hub/logger` `createPerformanceTimer`.
 *
 * Legacy 3-arg form `(logger, operation, correlationId?)` ignores the logger argument.
 */
export function createPerformanceTimer(
  operation: string,
  correlationId?: string,
): { end: () => void };
export function createPerformanceTimer(
  _logger: unknown,
  operation: string,
  correlationId?: string,
): { end: () => void };
export function createPerformanceTimer(...args: unknown[]): {
  end: () => void;
} {
  if (typeof args[0] === 'string') {
    return createTimer(
      args[0] as string,
      typeof args[1] === 'string' ? (args[1] as string) : undefined,
    );
  }
  if (typeof args[1] === 'string') {
    return createTimer(
      args[1] as string,
      typeof args[2] === 'string' ? (args[2] as string) : undefined,
    );
  }
  throw new Error(
    'createPerformanceTimer: expected (operation, correlationId?) or (logger, operation, correlationId?)',
  );
}
