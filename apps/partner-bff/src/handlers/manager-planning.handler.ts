import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { LambdaPartnerInternalClient } from '../clients/partner-internal.client';
import { ManagerPlanningService, parseManagerPlanningQuery } from '../features/manager-planning/manager-planning.service';
import { resolvePartnerActor } from '../shared/actor';
import { queryOf } from '../shared/http';

const client = new LambdaPartnerInternalClient();
const service = new ManagerPlanningService(client);

export const handleManagerPlanning = withApiHandler(
  { operation: 'partnerManagerPlanning' },
  async (request: LambdaRequest) => {
    const actor = await resolvePartnerActor(request, client);
    return service.get(actor, parseManagerPlanningQuery(queryOf(request), new Date()));
  },
);
