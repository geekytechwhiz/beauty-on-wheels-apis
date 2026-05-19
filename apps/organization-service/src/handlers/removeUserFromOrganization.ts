import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateOrganizationIdAndUserIdParams } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Params {
  organizationId: string;
  userId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { organizationId, userId } = req.params;
  const { correlationId } = req.context;
  await organizationService.removeUserFromOrganization(organizationId, userId, correlationId);
  return null;
};

export const main = withApiHandler({ operation: 'removeUserFromOrganization', validator: validateOrganizationIdAndUserIdParams }, handler);
