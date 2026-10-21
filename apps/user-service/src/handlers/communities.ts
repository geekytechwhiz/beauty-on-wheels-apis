import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getCommunitiesController } from '../controllers/communities.controller';
import {
  validateCommunityCreate,
  validateCommunityUpdate,
  validateCustomerCommunitiesUpdate,
} from '../schemas/communities.schema';

const controller = getCommunitiesController();

export const handleCreateCommunity = withApiHandler(
  {
    operation: 'createCommunity',
    validator: (request: LambdaRequest) => {
      validateCommunityCreate(request);
    },
  },
  async (request: LambdaRequest) => controller.createCommunity(request),
);

export const handleListCommunities = withApiHandler(
  { operation: 'listCommunities' },
  async (request: LambdaRequest) => controller.listCommunities(request),
);

export const handleGetCommunity = withApiHandler(
  { operation: 'getCommunity' },
  async (request: LambdaRequest) => controller.getCommunity(request),
);

export const handleUpdateCommunity = withApiHandler(
  {
    operation: 'updateCommunity',
    validator: (request: LambdaRequest) => {
      validateCommunityUpdate(request);
    },
  },
  async (request: LambdaRequest) => controller.updateCommunity(request),
);

export const handleDeleteCommunity = withApiHandler(
  { operation: 'deleteCommunity' },
  async (request: LambdaRequest) => controller.deleteCommunity(request),
);

export const handleGetCustomerCommunities = withApiHandler(
  { operation: 'getCustomerCommunities' },
  async (request: LambdaRequest) => controller.getMembership(request),
);

export const handlePutCustomerCommunities = withApiHandler(
  {
    operation: 'putCustomerCommunities',
    validator: (request: LambdaRequest) => {
      validateCustomerCommunitiesUpdate(request);
    },
  },
  async (request: LambdaRequest) => controller.putMembership(request),
);
