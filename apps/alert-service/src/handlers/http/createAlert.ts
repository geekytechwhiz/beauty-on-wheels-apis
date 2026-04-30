import { createApiHandler, createdResponse } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { createAlertHttpBodySchema } from '../../validators/alert.schemas';
import { validateCreateAlertRequest } from '../../validators/request.validators';

const controller = getAlertHttpController();

export const main = createApiHandler(
  {
    operation: 'alert.create',
    bodySchema: createAlertHttpBodySchema,
    validator: (req) =>
      validateCreateAlertRequest(req as unknown as LambdaRequest),
  },
  async (req) => {
    const data = await controller.handleCreateAlert(req as unknown as LambdaRequest);
    const correlationId =
      (req.context as { correlationId?: string }).correlationId ?? 'unknown';
    return createdResponse(data, undefined, { correlationId });
  },
);
