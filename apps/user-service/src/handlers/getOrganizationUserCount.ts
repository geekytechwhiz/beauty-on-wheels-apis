import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateGetOrganizationUserCount } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  organizationId?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const organizationId = req.params.organizationId ?? req.context.user?.organizationId!;
  const { correlationId } = req.context;
  return userService.getOrganizationUserCounts(
    organizationId,
    undefined,
    correlationId,
  );
};

export const main = withLambdaHandler(handler, {
  validator: validateGetOrganizationUserCount,
});
