import { LambdaRequest } from '@api-hub/utils';

import { getCrewController } from '../controllers/crew.controller';
import {
  validateCreateCrewRequest,
  validateUpdateCrewRequest,
} from '../schemas/crew.schema';
import { withVendorApiHandler } from './with-vendor-handler';

const controller = getCrewController();

export const handleListvendorcrews = withVendorApiHandler(
  { operation: 'listvendorcrews' },
  async (request: LambdaRequest) => controller.handleListvendorcrews(request),
);

export const handleCreatevendorcrew = withVendorApiHandler(
  {
    operation: 'createvendorcrew',
    validator: (request: LambdaRequest) => { validateCreateCrewRequest(request); },
  },
  async (request: LambdaRequest) => controller.handleCreatevendorcrew(request),
);

export const handleGetvendorcrew = withVendorApiHandler(
  { operation: 'getvendorcrew' },
  async (request: LambdaRequest) => controller.handleGetvendorcrew(request),
);

export const handleUpdatevendorcrew = withVendorApiHandler(
  {
    operation: 'updatevendorcrew',
    validator: (request: LambdaRequest) => { validateUpdateCrewRequest(request); },
  },
  async (request: LambdaRequest) => controller.handleUpdatevendorcrew(request),
);

export const handleDeactivatevendorcrew = withVendorApiHandler(
  { operation: 'deactivatevendorcrew' },
  async (request: LambdaRequest) => controller.handleDeactivatevendorcrew(request),
);
