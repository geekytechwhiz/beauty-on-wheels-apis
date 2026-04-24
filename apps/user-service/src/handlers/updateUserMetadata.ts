import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUpdateUserMetadata } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  userId: string;
}

const handler = async (req: LambdaRequest<Params> & { validatedUpdateMetadata?: { metadata: Record<string, unknown> } }) => {
  const userId = req.pathParameters?.userId;
  const { metadata } = req.validatedUpdateMetadata!;
  return userService.updateUserMetadata(userId as string, metadata);
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateUserMetadata,
});
