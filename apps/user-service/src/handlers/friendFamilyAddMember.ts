import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../services/friendFamily.service';
import { validateAddMemberFriendFamily } from '../validation/request.validators';

const friendFamilyService = new FriendFamilyService();

interface Body {
  organizationID?: string;
  userId?: string;
  userID?: string;
  memberId: string;
  userName: string;
  memberName: string;
  relation: string;
  relationship: string;
  emergencyContact: boolean;
  manageHealth?: boolean;
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body as Body ?? {};
  const organizationID = body.organizationID ?? req.context.userContext?.organizationId ?? '';
  const userId = body.userId ?? body.userID ?? req.context.userContext?.userId ?? '';
  const authHeader = req.context.authHeader;
  const { organizationID: _o, ...addBody } = body as any;
  console.log("Organization Details: ", organizationID, userId, authHeader, addBody);
  return friendFamilyService.addMember(organizationID, { ...addBody, userId }, authHeader);
};

export const main = withLambdaHandler(handler, {
  validator: validateAddMemberFriendFamily,
});
