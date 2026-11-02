import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getAddonSuggestionsController } from '../controllers/addon-suggestions.controller';
import {
  validateCreateAddonSuggestion,
  validateReviewAddonSuggestion,
} from '../schemas/addon-suggestions.schema';
import { assertCatalogAdmin } from '../utils/helpers/catalog-admin';

const controller = getAddonSuggestionsController();

export const handlePostVendorAddonSuggestions = withApiHandler(
  {
    operation: 'postVendorAddonSuggestions',
    validator: (request: LambdaRequest) => {
      validateCreateAddonSuggestion(request);
    },
  },
  async (request: LambdaRequest) => controller.submit(request),
);

export const handleGetVendorAddonSuggestions = withApiHandler(
  { operation: 'getVendorAddonSuggestions' },
  async (request: LambdaRequest) => controller.listForVendor(request),
);

export const handleGetVendorAddonSuggestionById = withApiHandler(
  { operation: 'getVendorAddonSuggestionById' },
  async (request: LambdaRequest) => controller.getForVendor(request),
);

export const handleOpsListAddonSuggestions = withApiHandler(
  {
    operation: 'opsListAddonSuggestions',
    validator: (request: LambdaRequest) => {
      assertCatalogAdmin(request);
    },
  },
  async (request: LambdaRequest) => controller.opsList(request),
);

export const handleOpsReviewAddonSuggestion = withApiHandler(
  {
    operation: 'opsReviewAddonSuggestion',
    validator: (request: LambdaRequest) => {
      assertCatalogAdmin(request);
      validateReviewAddonSuggestion(request);
    },
  },
  async (request: LambdaRequest) => controller.review(request),
);
