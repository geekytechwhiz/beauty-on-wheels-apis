import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';

const organizationService = new OrganizationService();

interface Params {
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { correlationId } = req.context;
  return organizationService.getOrganizationCounts(correlationId);
};

export const main = withApiHandler({ operation: 'getOrganizationCount' }, handler);
