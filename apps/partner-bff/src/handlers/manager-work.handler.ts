import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { LambdaPartnerInternalClient } from '../clients/partner-internal.client';
import { ManagerWorkService, parseManagerWorkQuery } from '../features/manager-work/manager-work.service';
import { resolvePartnerActor } from '../shared/actor';
import { queryOf } from '../shared/http';

const client = new LambdaPartnerInternalClient();
const service = new ManagerWorkService(client);

export const handleManagerWork = withApiHandler(
  { operation: 'partnerManagerWork' },
  async (request: LambdaRequest) => {
    const actor = await resolvePartnerActor(request, client);
    return service.get(actor, parseManagerWorkQuery(queryOf(request), new Date()));
  },
);
