import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateAssignUserToOrganization } from '../validation/request.validators';

const userService = new UserService();

interface Body {
  userId: string;
  organizationId: string;
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body!;
  await userService.assignUserToOrganization(body.userId, body.organizationId);
  return null;
};

export const main = withLambdaHandler(handler, {
  validator: validateAssignUserToOrganization,
});
