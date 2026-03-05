import { withLambdaHandler, LambdaRequest, validateUserOrganizationRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service'; 

const userService = new UserService();

interface Params {
  userId: string;
  organizationId: string;
  defaultProfile?: string;
  userType?: string;
}

const handler = async (
  req: LambdaRequest<Params>
) => {

  const { userId, organizationId, defaultProfile, userType } = req.params;
  const { user, authHeader } = req.context;

  return userService.getUserWithOrganizationDetails(
    userId,
    organizationId,
    user?.userId,
    defaultProfile,
    userType,
    authHeader
  );
};

export const main = withLambdaHandler(handler, {
  validator: validateUserOrganizationRequest,
});