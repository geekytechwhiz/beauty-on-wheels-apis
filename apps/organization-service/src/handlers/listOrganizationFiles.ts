import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateOrganizationIdParam } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Params {
  organizationId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { organizationId } = req.params;
  return organizationService.listOrganizationFiles(organizationId);
};

export const main = withLambdaHandler(handler, {
  validator: validateOrganizationIdParam,
});
