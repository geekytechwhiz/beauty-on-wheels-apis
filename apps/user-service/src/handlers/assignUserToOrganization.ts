import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
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

export const main = withApiHandler({ operation: 'assignUserToOrganization', validator: validateAssignUserToOrganization }, handler);
