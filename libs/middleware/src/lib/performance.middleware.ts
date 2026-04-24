// performanceMiddleware.ts

import { createPerformanceTimer, logger } from '@api-hub/observability';

export const performanceMiddleware = (operation: string) => {
  return async ({ next }: any) => {
    const timer = createPerformanceTimer(logger, operation);

    try {
      return await next();
    } finally {
      timer.end();
    }
  };
};