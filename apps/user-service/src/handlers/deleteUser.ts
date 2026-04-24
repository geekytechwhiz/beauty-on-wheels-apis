import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
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
  await userService.deleteUser(userId as string, organizationId as string, correlationId);
  return null;
};

export const main = withLambdaHandler(handler, {
  validator: validateUserOrganizationRequest,
});``
