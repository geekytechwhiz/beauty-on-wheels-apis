import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getStaffAssignedWorkService } from '../services/staff-assigned-work.service';

export const handleListStaffAssignedWork = withApiHandler(
  { operation: 'liststaffassignedwork' },
  async (request: LambdaRequest) => getStaffAssignedWorkService().list(request),
);

export const handleStartStaffVisit = withApiHandler(
  { operation: 'startstaffpackagevisit' },
  async (request: LambdaRequest) => getStaffAssignedWorkService().start(request),
);

export const handleCompleteStaffVisit = withApiHandler(
  { operation: 'completestaffpackagevisit' },
  async (request: LambdaRequest) => getStaffAssignedWorkService().complete(request),
);

export const handleMissStaffVisit = withApiHandler(
  { operation: 'missstaffpackagevisit' },
  async (request: LambdaRequest) => getStaffAssignedWorkService().miss(request),
);
