import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { HttpPartnerInternalClient } from '../clients/partner-internal.client';
import { ManagerHomeService } from '../features/manager-home/manager-home.service';
import { resolvePartnerActor } from '../shared/actor';

const client = new HttpPartnerInternalClient();
const service = new ManagerHomeService(client);

export const handleManagerHome = withApiHandler(
  { operation: 'partnerManagerHome' },
  async (request: LambdaRequest) => service.get(await resolvePartnerActor(request, client)),
);
