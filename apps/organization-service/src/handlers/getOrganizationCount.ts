import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';

const organizationService = new OrganizationService();
 
const handler = async (req: LambdaRequest) => {
  const { correlationId } = req.context;
  return organizationService.getOrganizationCounts(correlationId);
};

export const main = withApiHandler({ operation: 'getOrganizationCount' }, handler);
