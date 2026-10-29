import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getVendorPackageVisitsService } from '../services/vendor-package-visits.service';

export const handleListVendorPackageVisits = withApiHandler(
  { operation: 'listvendorpackagevisits' },
  async (request: LambdaRequest) => getVendorPackageVisitsService().list(request),
);

export const handleSummarizeVendorPackageVisits = withApiHandler(
  { operation: 'summarizevendorpackagevisits' },
  async (request: LambdaRequest) => getVendorPackageVisitsService().summary(request),
);
