import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { fhirUserHandlerOptions } from '../../utils/fhir-handler-options';
import { validateAssignUserToOrganization } from '../../validation/request.validators';

const userService = new UserService();

interface Body {
  userId: string;
  organizationId: string;
}

export const handler = withApiHandler(
  {
    operation: 'user.assignUserToOrganization',
    validator: validateAssignUserToOrganization,
    fhir: fhirUserHandlerOptions,
  },
  async (req: LambdaRequest<Record<string, unknown>, Body>) => {
    const body = req.body!;
    await userService.assignUserToOrganization(body.userId, body.organizationId);
    return {
      userID: body.userId,
      organizationID: body.organizationId,
    };
  },
);
