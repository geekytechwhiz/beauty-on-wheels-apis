import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from '@api-hub/utils';

import { getOnboardingController } from '../controllers/onboarding.controller';
import { validateUpdateOnboardingRequest } from '../schemas/onboarding.schema';

const controller = getOnboardingController();

export const handleGetvendoronboarding = withVendorApiHandler(
  {
    operation: 'getvendoronboarding',
  },
  async (request: LambdaRequest) => controller.handleGetvendoronboarding(request),
);

export const handleUpdatevendoronboarding = withVendorApiHandler(
  {
    operation: 'updatevendoronboarding',
    validator: (request: LambdaRequest) => {
      validateUpdateOnboardingRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendoronboarding(request),
);

export const handleSubmitvendorforreview = withVendorApiHandler(
  {
    operation: 'submitvendorforreview',
  },
  async (request: LambdaRequest) =>
    controller.handleSubmitvendorforreview(request),
);
