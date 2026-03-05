import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUpdateUserMetadata } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  userId: string;
}

const handler = async (req: LambdaRequest<Params> & { validatedUpdateMetadata?: { metadata: Record<string, unknown> } }) => {
  const { userId } = req.params;
  const { metadata } = req.validatedUpdateMetadata!;
  return userService.updateUserMetadata(userId, metadata);
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateUserMetadata,
});
