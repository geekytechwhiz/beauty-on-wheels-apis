import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getBankDetailsController } from '../controllers/bank-details.controller';
import { validateBankDetailsRequest } from '../schemas/bank-details.schema';

const controller = getBankDetailsController();

export const handleGetvendorbankdetails = withApiHandler(
  { operation: 'getvendorbankdetails' },
  async (request: LambdaRequest) =>
    controller.handleGetvendorbankdetails(request),
);

export const handleUpdatevendorbankdetails = withApiHandler(
  {
    operation: 'updatevendorbankdetails',
    validator: (request: LambdaRequest) => {
      validateBankDetailsRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendorbankdetails(request),
);
