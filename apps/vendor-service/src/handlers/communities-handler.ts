import { LambdaRequest } from '@api-hub/utils';

import { getCommunitiesController } from '../controllers/communities.controller';
import {
  validateAddVendorCommunityRequest,
  validateCommunityCoverageApprovalRequest,
  validateReplacePartnerCommunityCoverageRequest,
  validateReplaceVendorCommunitiesRequest,
} from '../schemas/communities.schema';
import { withApiHandler } from '@api-hub/middleware';
import { withVendorApiHandler } from './with-vendor-handler';

const controller = getCommunitiesController();

export const handleListvendorcommunities = withApiHandler(
  { operation: 'listvendorcommunities' },
  async (request: LambdaRequest) =>
    controller.handleListvendorcommunities(request),
);

export const handleListcommunities = withApiHandler(
  { operation: 'listcommunities' },
  async (request: LambdaRequest) =>
    controller.handleListcommunities(request),
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

export const handleListPartnerCommunityDirectory = withApiHandler(
  { operation: 'listPartnerCommunityDirectory' },
  async (request: LambdaRequest) =>
    controller.handleListPartnerCommunityDirectory(request),
);

export const handleGetPartnerCommunityCoverage = withApiHandler(
  { operation: 'getPartnerCommunityCoverage' },
  async (request: LambdaRequest) =>
    controller.handleGetPartnerCommunityCoverage(request),
);

export const handleReplacePartnerCommunityCoverage = withApiHandler(
  {
    operation: 'replacePartnerCommunityCoverage',
    validator: (request: LambdaRequest) => {
      validateReplacePartnerCommunityCoverageRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleReplacePartnerCommunityCoverage(request),
);

export const handleUpdatecommunitycoverageapproval = withVendorApiHandler(
  {
    operation: 'updatecommunitycoverageapproval',
    validator: (request: LambdaRequest) => {
      validateCommunityCoverageApprovalRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatecommunitycoverageapproval(request),
);
