 
import { withLoggerContext } from '@api-hub/observability';

export const loggerMiddleware = () => {
  return async ({ event, next }: any) => {
    const ctx = event.__context || {};

    return withLoggerContext(ctx, async () => {
      return next();
    });
  };
};