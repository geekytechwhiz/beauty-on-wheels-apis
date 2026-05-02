import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../services/friendFamily.service';
import { validateUpdateFriendFamily } from '../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const friendFamilyService = new FriendFamilyService();

interface Body {
  organizationID?: string;
  userId?: string;
  userID?: string;
  memberId: string;
  fullName?: string;
  relation?: string;
  relationship?: string;
  emergencyContact?: boolean;
  manageHealth?: boolean;
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body ?? {};
  const userId = body.userId ?? body.userID ?? req.context.userContext?.userId ?? '';
  const orgId = body.organizationID ?? req.context.userContext?.organizationId ?? '';
  const validated = body as any;
  await friendFamilyService.updateMember(userId, orgId, validated);
  return null;
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateFriendFamily,
});
