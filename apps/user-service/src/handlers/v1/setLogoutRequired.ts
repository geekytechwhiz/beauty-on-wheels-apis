import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateUserOrganizationRequest } from '../../validation/request.validators';

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

export const main =   withApiHandler(
          {
            operation: 'setLogoutRequired',
            validator: (req) => validateUserOrganizationRequest(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
