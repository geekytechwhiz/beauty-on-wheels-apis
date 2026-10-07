import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getAddressesController } from '../controllers/addresses.controller';
import { validateAddressRequest } from '../schemas/addresses.schema';

const controller = getAddressesController();

export const handleListAddresses = withApiHandler(
  { operation: 'listAddresses' },
  async (request: LambdaRequest) => controller.listAddresses(request),
);

export const handleCreateAddress = withApiHandler(
  {
    operation: 'createAddress',
    validator: (request: LambdaRequest) => {
      validateAddressRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.createAddress(request),
);

export const handleUpdateAddress = withApiHandler(
  {
    operation: 'updateAddress',
    validator: (request: LambdaRequest) => {
      validateAddressRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.updateAddress(request),
);

export const handleDeleteAddress = withApiHandler(
  { operation: 'deleteAddress' },
  async (request: LambdaRequest) => controller.deleteAddress(request),
);
