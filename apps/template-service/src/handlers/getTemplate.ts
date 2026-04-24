// import { buildGetTemplateHandler } from '@api-hub/template';
// import { getTemplateRuntime } from '../runtime';

// export const main = buildGetTemplateHandler(getTemplateRuntime().getTemplateUseCase);

// handler.ts

import { runMiddlewares } from '@api-hub/event-platform';
import { contextMiddleware } from '@api-hub/event-platform';
import { loggerMiddleware } from '@api-hub/middleware';
import { idempotencyMiddleware } from '@api-hub/middleware';
import { idempotencyStore } from '@api-hub/event-platform';
import { logger } from '@api-hub/logger';

const middlewares = [
  contextMiddleware(),
  loggerMiddleware(),
  idempotencyMiddleware({
    getKey: (event) => event.id,
    store: idempotencyStore,
  }),
];

const businessHandler = async (event: any) => {
  logger.info({
    message: 'Processing business logic',
    eventId: event.id,
  });

  // simulate work
  return {
    success: true,
    processedAt: new Date().toISOString(),
  };
};

export const handler = runMiddlewares(
  middlewares,
  businessHandler
);