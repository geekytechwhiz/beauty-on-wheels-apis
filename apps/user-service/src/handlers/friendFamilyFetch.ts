import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../services/friendFamily.service';
import { validateFetchFriendFamily } from '../validation/request.validators';

const friendFamilyService = new FriendFamilyService();

interface Params {
  userId?: string;
}

interface Body {
  userId?: string;
  userID?: string;
}

const handler = async (req: LambdaRequest<Params, Body>) => {
  const body = req.body ?? {};
  const userId = body.userId ?? body.userID ?? req.params.userId ?? req.context.userContext?.userId ?? '';
  return friendFamilyService.fetchMembers(userId);
};

export const main = withLambdaHandler(handler, {
  validator: validateFetchFriendFamily,
});
