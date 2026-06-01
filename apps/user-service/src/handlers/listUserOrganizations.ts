import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { fhirUserListHandlerOptions } from '../utils/fhir-handler-options';
import { validateUserIdParam } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  userId?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const userId = (req.pathParameters?.userId ?? req.params?.userId) as string;
  return userService.listUserOrganizations(userId);
};

export const main = withApiHandler(
  {
    operation: 'listUserOrganizations',
    validator: validateUserIdParam,
    fhir: fhirUserListHandlerOptions,
  },
  handler,
);
