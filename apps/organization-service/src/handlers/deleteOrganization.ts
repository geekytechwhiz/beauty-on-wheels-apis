import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import {
  validateOrganizationIdParam,
} from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Params {
  organizationId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { organizationId } = req.params;
  const { correlationId } = req.context;
  await organizationService.deleteOrganization(organizationId, correlationId);
  return null;
};

export const main = withLambdaHandler(handler, {
  validator: validateOrganizationIdParam,
});
