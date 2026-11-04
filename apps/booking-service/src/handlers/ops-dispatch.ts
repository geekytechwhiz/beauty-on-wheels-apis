import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOpsDispatchService } from '../services/ops-dispatch.service';

export const handleOpsListDispatchVisits = withApiHandler(
  { operation: 'opsListDispatchPackageVisits' },
  async (request: LambdaRequest) => getOpsDispatchService().listDispatch(request),
);

export const handleOpsReadPackageVisitDemand = withApiHandler(
  { operation: 'opsReadPackageVisitDemand' },
  async (request: LambdaRequest) => getOpsDispatchService().readDemand(request),
);
