import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateAssignUserToOrganization } from '../../validation/request.validators';

const userService = new UserService();
 

export const handler =   withApiHandler(
  {
    operation: 'user.assignUserToOrganization',
    validator: (req) =>
      validateAssignUserToOrganization(req as unknown as LambdaRequest),
  },
  async (req) => {
    const body = req.body as { userId: string; organizationId: string };

    await userService.assignUserToOrganization(
      body.userId,
      body.organizationId,
    );

    return null;
  },
);
