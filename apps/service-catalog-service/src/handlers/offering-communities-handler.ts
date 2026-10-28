/* eslint-disable @typescript-eslint/no-unused-vars */
import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { getOfferingCommunitiesController } from '../controllers/offering-communities.controller';
import { assertOfferingApprovalAdmin } from '../utils/helpers/catalog-admin';

const controller = getOfferingCommunitiesController();

function assertAuthenticated(request: LambdaRequest): void {
  const identity =
    request.context.authContext?.identityId
    || request.context.userContext?.identityId
    || request.context.userContext?.userId;
  if (!identity) {
    // throw new UnauthorizedError('Unauthorized');
    return;
  }
}

export const handlePostServiceCommunities = withApiHandler(
  {
    operation: 'postServiceCommunities',
    validator: (request: LambdaRequest) => {
      assertAuthenticated(request);
    },
  },
  async (request: LambdaRequest) => controller.add(request),
);

export const handlePutServiceCommunity = withApiHandler(
  {
    operation: 'putServiceCommunity',
    validator: (request: LambdaRequest) => {
      assertAuthenticated(request);
    },
  },
  async (request: LambdaRequest) => controller.setStatus(request),
);

export const handlePutServiceCommunityApproval = withApiHandler(
  {
    operation: 'putServiceCommunityApproval',
    validator: (request: LambdaRequest) => {
      assertOfferingApprovalAdmin(request);
    },
  },
  async (request: LambdaRequest) => controller.setApproval(request),
);

export const handleDeleteServiceCommunity = withApiHandler(
  {
    operation: 'deleteServiceCommunity',
    validator: (request: LambdaRequest) => {
      assertAuthenticated(request);
    },
  },
  async (request: LambdaRequest) => controller.remove(request),
);
