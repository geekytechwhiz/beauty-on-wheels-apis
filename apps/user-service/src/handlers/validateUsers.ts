import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserValidationService } from '../services/userValidation.service';
import { validateValidateUsers } from '../validation/request.validators';

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

export const main = withLambdaHandler(handler, {
  validator: validateValidateUsers,
});
