import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { OrganizationRepository } from '../repositories/organization.repository';
import { validateUserOrganizationRequest } from '../validation/request.validators';

const userService = new UserService();
const organizationRepository = new OrganizationRepository();

interface Params {
  userId?: string;
  organizationId?: string;
  userType?: string;
  defaultProfile?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  // Supports API Gateway (pathParameters), direct Lambda invocations (params),
  // and nested-data Lambda invocations: { data: { userID, organizationID } }
  const directData = (req.event as any)?.data;
  const userId = (
    req.pathParameters?.userId ??
    req.params.userId ??
    directData?.userID ??
    directData?.userId ??
    req.context.userContext?.userId
  ) as string;
  const organizationId = (
    req.params.organizationId ??
    directData?.organizationID ??
    directData?.organizationId ??
    req.context.userContext?.organizationId
  ) as string;
  const userType = req.params.userType;

  const user = await userService.getUser(userId, organizationId);
  if (!user || typeof user !== 'object') {
    const { UserNotFoundError } = await import('../errors');
    throw new UserNotFoundError(userId);
  }

  const orgData = await organizationRepository.getOrganizationFromDB(organizationId).catch(() => null);

  const transformedUser = (await userService
    .transformUserForResponse(user, organizationId, userType, orgData ?? undefined, organizationId)
    .catch(() => ({
      userID: (user as any).userID ?? userId,
      organizationID: (user as any).organizationID ?? organizationId,
      emailAddress: (user as any).emailAddress ?? '',
      phoneNumber: (user as any).phoneNumber ?? '',
      firstName: (user as any).firstName ?? '',
      lastName: (user as any).lastName ?? '',
      fullName: (user as any).fullName ?? '',
    }))) as Record<string, unknown>;

  return transformedUser;
};

export const main = withLambdaHandler(handler, {
  validator: validateUserOrganizationRequest,
});
