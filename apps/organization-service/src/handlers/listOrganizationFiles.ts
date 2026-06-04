import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateOrganizationIdParam } from '../validation/request.validators';

const organizationService = new OrganizationService();
 

const handler = async (req: LambdaRequest) => {
  const { organizationId } = req.params;
  return organizationService.listOrganizationFiles(organizationId);
};

export const main = withApiHandler({ operation: 'listOrganizationFiles', validator: validateOrganizationIdParam }, handler);
