import { extractCorrelationId, extractAwsRequestId } from '@api-hub/logger';
  
  export const contextMiddleware = () => {
    return async ({ event, context, next }: any) => {
      const correlationId =
        extractCorrelationId(event) ||
        `corr-${Date.now()}`;
  
      const awsRequestId = extractAwsRequestId(context);
  
      const baseContext = {
        correlationId,
        awsRequestId,
        source: event?.source,
        eventType: event?.['detail-type'] || event?.type,
      };
  
      // Attach to event for downstream
      event.__context = baseContext;
  
      return next();
    };
  };