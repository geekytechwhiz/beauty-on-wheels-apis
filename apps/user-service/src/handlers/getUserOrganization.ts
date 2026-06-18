import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { fhirUserHandlerOptions } from '../utils/fhir-handler-options';

const userService = new UserService();

interface Params {
  userId?: string;
  organizationId?: string;
  defaultProfile?: string;
  userType?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { userType } = req.params ?? {};
  const { userContext } = req.context;

  let pathUserId = (req.pathParameters?.userId ?? req.params?.userId ?? '').trim();
  let pathOrganizationId = (
    req.pathParameters?.organizationId ?? req.params?.organizationId ?? ''
  ).trim();
  if (!pathUserId) {
    pathUserId = userContext?.userId as string;
  }
  if (!pathOrganizationId) {
    pathOrganizationId = userContext?.organizationId as string;
  }

  return userService.getUserWithOrganizationDetails(
    pathUserId as string,
    pathOrganizationId as string,
    userContext?.userId as string | undefined,
    undefined,
    userType,
    req.context?.authHeader as string,
  );
};

export const main = withApiHandler(
  {
    operation: 'getUserOrganization',
    fhir: { ...fhirUserHandlerOptions, validation: { enabled: true, failOnValidationError: false } },
  },
  handler,
);