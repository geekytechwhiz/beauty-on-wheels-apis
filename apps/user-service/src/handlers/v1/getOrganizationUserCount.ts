import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateGetOrganizationUserCount } from '../../validation/request.validators';

const userService = new UserService();

interface Params {
  organizationId?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const organizationId = req.params.organizationId ?? req.context.userContext?.organizationId!;
  const { correlationId } = req.context;
  return userService.getOrganizationUserCounts(
    organizationId,
    undefined,
    correlationId,
  );
};

export const main =   withApiHandler(
          {
            operation: 'getOrganizationUserCount',
            validator: (req) => validateGetOrganizationUserCount(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
