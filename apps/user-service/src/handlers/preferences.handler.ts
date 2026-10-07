import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getPreferencesController } from '../controllers/preferences.controller';
import { validateOperationalPreferencesUpdate } from '../schemas/preferences.schema';

const controller = getPreferencesController();

export const handleGetPreferences = withApiHandler(
  { operation: 'getPreferences' },
  async (request: LambdaRequest) => controller.getPreferences(request),
);

export const handlePutPreferences = withApiHandler(
  {
    operation: 'putPreferences',
    validator: (request: LambdaRequest) => {
      validateOperationalPreferencesUpdate(request);
    },
  },
  async (request: LambdaRequest) => controller.putPreferences(request),
);
