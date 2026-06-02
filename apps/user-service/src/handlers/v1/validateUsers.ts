import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserValidationService } from '../../services/userValidation.service';
import { fhirUserHandlerOptions } from '../../utils/fhir-handler-options';
import { validateValidateUsers } from '../../validation/request.validators';

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
  if (exists && cognitoUser && typeof cognitoUser === 'object') {
    return {
      exists: true,
      cognitoUser,
      ...(cognitoUser as Record<string, unknown>),
    };
  }
  if (exists) {
    return { exists: true, cognitoUser };
  }
  return { exists: false };
};

export const main = withApiHandler(
  {
    operation: 'validateUsers',
    validator: validateValidateUsers,
    fhir: fhirUserHandlerOptions,
  },
  handler,
);
