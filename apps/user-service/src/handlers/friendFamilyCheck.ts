import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { FriendFamilyService } from '../services/friendFamily.service';
import { validateFriendFamilyCheck } from '../validation/request.validators';

const friendFamilyService = new FriendFamilyService();

interface Params {
  inviterId?: string;
  inviteeId?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const inviterId = (req.params.inviterId ?? '').toString().trim();
  const inviteeId = (req.params.inviteeId ?? '').toString().trim();
  const mapping = await friendFamilyService.checkInvite(inviterId, inviteeId);
  if (!mapping) {
    const err: any = new Error('No friend-family invite found for this inviter and invitee');
    err.statusCode = 404;
    err.code = 'INVITE_NOT_FOUND';
    throw err;
  }
  return mapping;
};

export const main = withApiHandler({ operation: 'friendFamilyCheck', validator: validateFriendFamilyCheck }, handler);
