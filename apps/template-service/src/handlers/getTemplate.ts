// import { buildGetTemplateHandler } from '@api-hub/template';
// import { getTemplateRuntime } from '../runtime';

// export const main = buildGetTemplateHandler(getTemplateRuntime().getTemplateUseCase);

// handler.ts

import {
  createStandardLambdaHttpMiddlewares,
  runMiddlewares,
} from '@api-hub/middleware';
import { logger } from '@api-hub/logger';

const middlewares = createStandardLambdaHttpMiddlewares({
  serviceName: 'template-service',
  operation: 'template.get',
  payloadSchemas: {},
});

const businessHandler = async (event: Record<string, unknown>) => {
  logger.info({
    message: 'Processing business logic',
    eventId: event.id,
  });

  return {
    success: true,
    processedAt: new Date().toISOString(),
  };
};

export const handler = runMiddlewares(middlewares, businessHandler);
