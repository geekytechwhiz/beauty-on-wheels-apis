import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOfferingCommunitiesController } from '../controllers/offering-communities.controller';
import { assertCatalogAdmin, assertOfferingApprovalAdmin } from '../utils/helpers/catalog-admin';

const controller = getOfferingCommunitiesController();

export const handlePostServiceCommunities = withApiHandler(
  {
    operation: 'postServiceCommunities',
    validator: (request: LambdaRequest) => {
      assertCatalogAdmin(request);
    },
  },
  async (request: LambdaRequest) => controller.add(request),
);

export const handlePutServiceCommunity = withApiHandler(
  {
    operation: 'putServiceCommunity',
    validator: (request: LambdaRequest) => {
      assertCatalogAdmin(request);
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
      assertCatalogAdmin(request);
    },
  },
  async (request: LambdaRequest) => controller.remove(request),
);
