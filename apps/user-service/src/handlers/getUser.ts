import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
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
  // Supports both API Gateway (pathParameters) and direct Lambda invocations (params)
  const userId = (req.pathParameters?.userId ?? req.params.userId ?? req.context.userContext?.userId) as string;
  const organizationId = req.params.organizationId ?? req.context.userContext?.organizationId!;
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
