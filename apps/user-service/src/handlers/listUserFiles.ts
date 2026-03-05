import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUserIdParam } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  userId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { userId } = req.params;
  return userService.listUserFiles(userId);
};

export const main = withLambdaHandler(handler, {
  validator: validateUserIdParam,
});
