import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateSetOrgStatus } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Body {
  organizationId: string;
  status: 'ACTIVE' | 'HOLD' | 'DISABLED';
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body ?? {};
  const { organizationId, status } = body;
  const userId = req.context.user?.userId ?? (req.event?.requestContext?.authorizer?.userId ?? req.event?.requestContext?.authorizer?.userID);
  const userType = req.event?.requestContext?.authorizer?.userType as string | undefined;
  const { correlationId, authHeader } = req.context;

  return organizationService.setOrganizationStatus(
    organizationId,
    status,
    userId,
    userType,
    correlationId,
    authHeader,
  );
};

export const main = withLambdaHandler(handler, {
  validator: validateSetOrgStatus,
});
