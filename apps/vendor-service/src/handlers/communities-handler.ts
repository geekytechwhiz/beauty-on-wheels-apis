import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getCommunitiesController } from '../controllers/communities.controller';
import {
  validateAddVendorCommunityRequest,
  validateReplaceVendorCommunitiesRequest,
} from '../schemas/communities.schema';

const controller = getCommunitiesController();

export const handleListvendorcommunities = withApiHandler(
  { operation: 'listvendorcommunities' },
  async (request: LambdaRequest) =>
    controller.handleListvendorcommunities(request),
);

export const handleReplacevendorcommunities = withApiHandler(
  {
    operation: 'replacevendorcommunities',
    validator: (request: LambdaRequest) => {
      validateReplaceVendorCommunitiesRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleReplacevendorcommunities(request),
);

export const handleAddvendorcommunity = withApiHandler(
  {
    operation: 'addvendorcommunity',
    validator: (request: LambdaRequest) => {
      validateAddVendorCommunityRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleAddvendorcommunity(request),
);

export const handleRemovevendorcommunity = withApiHandler(
  { operation: 'removevendorcommunity' },
  async (request: LambdaRequest) =>
    controller.handleRemovevendorcommunity(request),
);
