import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserValidationService } from '../../services/userValidation.service';
import { validateValidateUsers } from '../../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const userValidationService = new UserValidationService();

interface Body {
  provider?: string;
  externalId?: string;
  tenantId?: string;
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body!;
  const { provider, externalId, tenantId } = body;
  const { correlationId } = req.context;
  const { exists, cognitoUser } = await userValidationService.validateUserExists(
    { provider: provider!, externalId: externalId!, tenantId: tenantId || '' },
    correlationId,
  );
  if (exists) {
    return { exists: true, cognitoUser };
  }
  return { exists: false };
};

export const main =   withApiHandler(
          {
            operation: 'validateUsers',
            validator: (req) => validateValidateUsers(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
