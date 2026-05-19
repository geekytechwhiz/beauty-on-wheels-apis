import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateOrganizationIdAndUserIdParams } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Params {
  organizationId: string;
  userId: string;
}

interface Body {
  role?: string;
}

const handler = async (req: LambdaRequest<Params, Body>) => {
  const { organizationId, userId } = req.params;
  const body = req.body ?? {};
  const { correlationId } = req.context;
  await organizationService.assignUserToOrganization(organizationId, userId, body.role, correlationId);
  return null;
};

export const main = withLambdaHandler(handler, {
  validator: validateOrganizationIdAndUserIdParams,
});
