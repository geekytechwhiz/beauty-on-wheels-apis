import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUserOrganizationRequest } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  userId?: string;
  organizationId?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const userId = req.params.userId ?? req.context.userContext?.userId!;
  const organizationId = req.params.organizationId ?? req.context.userContext?.organizationId!;
  const { correlationId } = req.context;
  await userService.deleteUser(userId, organizationId, correlationId);
  return null;
};

export const main = withLambdaHandler(handler, {
  validator: validateUserOrganizationRequest,
});
