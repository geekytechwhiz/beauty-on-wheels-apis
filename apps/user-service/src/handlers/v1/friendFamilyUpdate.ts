import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../../services/friendFamily.service';
import { validateUpdateFriendFamily } from '../../validation/request.validators';

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
  const body = req.body as Body ?? {};
  const userId = body.userId ?? body.userID ?? req.context.userContext?.userId ?? '';
  const orgId = body.organizationID ?? req.context.userContext?.organizationId ?? '';
  const validated = body as any;
  await friendFamilyService.updateMember(userId, orgId, validated);
  return null;
};

export const main =   withApiHandler(
          {
            operation: 'friendFamilyUpdate',
            validator: (req) => validateUpdateFriendFamily(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
