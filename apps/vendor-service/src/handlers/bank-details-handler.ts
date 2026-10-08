import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from '@api-hub/utils';

import { getBankDetailsController } from '../controllers/bank-details.controller';
import { validateBankDetailsRequest } from '../schemas/bank-details.schema';

const controller = getBankDetailsController();

export const handleGetvendorbankdetails = withVendorApiHandler(
  { operation: 'getvendorbankdetails' },
  async (request: LambdaRequest) =>
    controller.handleGetvendorbankdetails(request),
);

export const handleUpdatevendorbankdetails = withVendorApiHandler(
  {
    operation: 'updatevendorbankdetails',
    validator: (request: LambdaRequest) => {
      validateBankDetailsRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendorbankdetails(request),
);
