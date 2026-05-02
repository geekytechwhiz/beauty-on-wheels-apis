import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateUserIdParam } from '../../validation/request.validators';

const userService = new UserService();

interface Params {
  userId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const userId = req.pathParameters?.userId;
  return userService.listUserOrganizations(userId as string);
};

export const main =   withApiHandler(
          {
            operation: 'listUserOrganizations',
            validator: (req) => validateUserIdParam(req as any),
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await (handler as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
