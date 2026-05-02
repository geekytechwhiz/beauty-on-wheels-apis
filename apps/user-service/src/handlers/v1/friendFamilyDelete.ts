import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../../services/friendFamily.service';
import { validateDeleteFriendFamily } from '../../validation/request.validators';

const friendFamilyService = new FriendFamilyService();

interface Body {
  userID: string;
  memberID: string;
  organizationID?: string;
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body!;
  const { userID, memberID, organizationID } = body;
  await friendFamilyService.deleteMember(userID, memberID, organizationID);
  return { userID, memberID, organizationID: organizationID ?? null };
};

export const main =   withApiHandler(
          {
            operation: 'friendFamilyDelete',
            validator: (req) => validateDeleteFriendFamily(req as any),
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await (handler as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
