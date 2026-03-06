import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUserOrganizationRequest } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  userId?: string;
  organizationId?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const userId = req.pathParameters?.userId;
  const organizationId = req.pathParameters?.organizationId; 
  const { correlationId } = req.context;
  await userService.updateUser(userId as string, organizationId as string, { logoutRequired: true }, correlationId);
  return { logoutRequired: true };
};

export const main = withLambdaHandler(handler, {
  validator: validateUserOrganizationRequest,
});
