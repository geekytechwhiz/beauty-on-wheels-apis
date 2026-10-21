import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getCustomersController } from '../controllers/customers.controller';
import { validateCustomerProfileUpdate } from '../schemas/customers.schema';

const controller = getCustomersController();

export const handleGetCustomer = withApiHandler(
  { operation: 'getCustomer' },
  async (request: LambdaRequest) => controller.getCustomer(request),
);

export const handlePutCustomer = withApiHandler(
  {
    operation: 'putCustomer',
    validator: (request: LambdaRequest) => {
      validateCustomerProfileUpdate(request);
    },
  },
  async (request: LambdaRequest) => controller.putCustomer(request),
);
