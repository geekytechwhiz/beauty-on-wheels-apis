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
  const userId = req.params.userId ?? req.context.user?.userId!;
  const organizationId = req.params.organizationId ?? req.context.user?.organizationId!;
  const userType = req.params.userType;
  const defaultProfile = req.params.defaultProfile;

  const user = await userService.getUser(userId, organizationId);
  if (!user || typeof user !== 'object') {
    const { UserNotFoundError } = await import('../errors');
    throw new UserNotFoundError(userId);
  }

  const orgData = await organizationRepository.getOrganizationFromDB(organizationId).catch(() => null);

  const transformedUser = (await userService
    .transformUserForResponse(user, organizationId, userType, orgData ?? undefined, defaultProfile)
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
