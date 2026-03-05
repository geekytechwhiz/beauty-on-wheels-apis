import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
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

export const main = withLambdaHandler(handler, {
  validator: validateOrganizationIdAndUserIdParams,
});
