import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from '@api-hub/utils';

import { getCommunitiesController } from '../controllers/communities.controller';
import {
  validateAddVendorCommunityRequest,
  validateReplaceVendorCommunitiesRequest,
} from '../schemas/communities.schema';

const controller = getCommunitiesController();

export const handleListvendorcommunities = withVendorApiHandler(
  { operation: 'listvendorcommunities' },
  async (request: LambdaRequest) =>
    controller.handleListvendorcommunities(request),
);

export const handleReplacevendorcommunities = withVendorApiHandler(
  {
    operation: 'replacevendorcommunities',
    validator: (request: LambdaRequest) => {
      validateReplaceVendorCommunitiesRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleReplacevendorcommunities(request),
);

export const handleAddvendorcommunity = withVendorApiHandler(
  {
    operation: 'addvendorcommunity',
    validator: (request: LambdaRequest) => {
      validateAddVendorCommunityRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleAddvendorcommunity(request),
);

export const handleRemovevendorcommunity = withVendorApiHandler(
  { operation: 'removevendorcommunity' },
  async (request: LambdaRequest) =>
    controller.handleRemovevendorcommunity(request),
);
