import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOfferingsController } from '../controllers/offerings.controller';
import {
  validateCreateOffering,
  validatePatchOffering,
} from '../schemas/offerings.schema';

const controller = getOfferingsController();

export const getOfferings = withApiHandler(
  { operation: 'getOfferings' },
  async (request: LambdaRequest) => controller.handleGetOfferings(request),
);

export const postOfferings = withApiHandler(
  {
    operation: 'postOfferings',
    validator: (request: LambdaRequest) => {
      validateCreateOffering(request);
    },
  },
  async (request: LambdaRequest) => controller.handleCreateOffering(request),
);

export const getOfferingById = withApiHandler(
  { operation: 'getOfferingById' },
  async (request: LambdaRequest) => controller.handleGetOffering(request),
);

export const patchOfferingById = withApiHandler(
  {
    operation: 'patchOfferingById',
    validator: (request: LambdaRequest) => {
      validatePatchOffering(request);
    },
  },
  async (request: LambdaRequest) => controller.handlePatchOffering(request),
);

export const deleteOfferingById = withApiHandler(
  { operation: 'deleteOfferingById' },
  async (request: LambdaRequest) => controller.handleDeleteOffering(request),
);

export const getMyOfferings = withApiHandler(
  { operation: 'getMyOfferings' },
  async (request: LambdaRequest) => controller.handleListMyOfferings(request),
);
