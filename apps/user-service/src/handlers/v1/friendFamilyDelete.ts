import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../../services/friendFamily.service';
import { validateDeleteFriendFamily } from '../../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

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
    return await (handler as any)(req);
  },
        );
