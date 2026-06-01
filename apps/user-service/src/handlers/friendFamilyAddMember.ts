import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../services/friendFamily.service';
import { fhirRelatedPersonHandlerOptions } from '../utils/fhir-handler-options';
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
  // console.log("Organization Details: ", organizationID, userId, authHeader, addBody);
  return friendFamilyService.addMember(organizationID, { ...addBody, userId }, authHeader);
};

export const main = withApiHandler(
  { operation: 'friendFamilyAddMember', validator: validateAddMemberFriendFamily, fhir: fhirRelatedPersonHandlerOptions },
  handler,
);
