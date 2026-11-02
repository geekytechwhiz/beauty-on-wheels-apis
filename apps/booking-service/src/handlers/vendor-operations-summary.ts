import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getVendorOperationsSummaryService } from '../services/vendor-operations-summary.service';

export const handleSummarizeVendorOperations = withApiHandler(
  { operation: 'summarizevendoroperations' },
  async (request: LambdaRequest) => getVendorOperationsSummaryService().summary(request),
);
