import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { fhirActivateDeactivateHandlerOptions } from '../../utils/fhir-handler-options';
import { validateActivateDeactivateUser } from '../../validation/request.validators';

const userService = new UserService();

const handler = async (req: LambdaRequest<any> & { validatedActivateDeactivate?: { action: string; organizationID: string; patientUserId: string } }) => {
  const { action, organizationID, patientUserId } = req.validatedActivateDeactivate!;
  const { correlationId, userContext } = req.context;
  const resolvedOrganizationId = userContext?.organizationId ?? organizationID;
  const actionNorm = action.toUpperCase() as 'ACTIVATE' | 'DEACTIVATE';
  await userService.activateDeactivateUser(resolvedOrganizationId, patientUserId, actionNorm, correlationId);
  return { message: actionNorm === 'ACTIVATE' ? 'User activated' : 'User deactivated' };
};

export const main = withApiHandler(
  {
    operation: 'activateDeactivateUser',
    validator: validateActivateDeactivateUser,
    fhir: fhirActivateDeactivateHandlerOptions,
  },
  handler,
);
