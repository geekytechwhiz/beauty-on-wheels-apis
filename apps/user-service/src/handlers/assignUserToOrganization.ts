import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateAssignUserToOrganization } from '../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

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
