import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getCrewAssignmentsService } from '../services/crew-assignments.service';

export const handleListCrewAssignments = withApiHandler(
  { operation: 'listvendorpackagevisitassignments' },
  async (request: LambdaRequest) => getCrewAssignmentsService().list(request),
);

export const handleAssignCrew = withApiHandler(
  { operation: 'assignvendorpackagevisits' },
  async (request: LambdaRequest) => getCrewAssignmentsService().assign(request),
);

export const handleUnassignCrew = withApiHandler(
  { operation: 'unassignvendorpackagevisit' },
  async (request: LambdaRequest) => getCrewAssignmentsService().remove(request),
);
