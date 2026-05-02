import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateActivateDeactivateUser } from '../../validation/request.validators';

const userService = new UserService();

const handler = async (req: LambdaRequest<any> & { validatedActivateDeactivate?: { action: string; organizationID: string; patientUserId: string } }) => {
  const { action, organizationID, patientUserId } = req.validatedActivateDeactivate!;
  const { correlationId, userContext } = req.context;
  // Prefer organizationId from the authorization token; fall back to request body value
  const resolvedOrganizationId = userContext?.organizationId ?? organizationID;
  const actionNorm = action.toUpperCase() as 'ACTIVATE' | 'DEACTIVATE';
  await userService.activateDeactivateUser(resolvedOrganizationId, patientUserId, actionNorm, correlationId);
  return { message: actionNorm === 'ACTIVATE' ? 'User activated' : 'User deactivated' };
};

export const main =   withApiHandler(
          {
            operation: 'activateDeactivateUser',
            validator: (req) => validateActivateDeactivateUser(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
