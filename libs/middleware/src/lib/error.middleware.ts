 
import { logger } from '@api-hub/observability';

 
export const errorMiddleware = () => {
  return async ({ event, next }: any) => {
    try {
      return await next();
    } catch (error) {
      logger.error({
        event: 'unhandled_error',
        error,
        eventPayload: event,
      });

      throw error;
    }
  };
};