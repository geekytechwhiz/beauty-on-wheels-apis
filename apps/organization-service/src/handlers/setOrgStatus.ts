import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { fhirOrganizationHandlerOptions } from '../utils/fhir-handler-options';
import { validateSetOrgStatus } from '../validation/request.validators';

const organizationService = new OrganizationService();
 
const handler = async (req: LambdaRequest) => {
  const body = req.body ?? {};
  const { organizationId, status } = body;
  const userId = req.context?.userContext?.userId ?? (req.event?.requestContext?.authorizer?.userId ?? req.event?.requestContext?.authorizer?.userID);
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

export const main = withApiHandler(
  { operation: 'setOrgStatus', validator: validateSetOrgStatus, fhir: fhirOrganizationHandlerOptions },
  handler,
);
