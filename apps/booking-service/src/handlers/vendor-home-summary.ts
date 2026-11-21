import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getVendorHomeSummaryService } from '../services/vendor-home-summary.service';

export const handleVendorHomeSummary = withApiHandler(
  { operation: 'getvendorhomesummary' },
  async (request: LambdaRequest) => getVendorHomeSummaryService().summary(request),
);
