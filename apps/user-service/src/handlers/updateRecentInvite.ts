import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUpdateRecentInvite } from '../validation/request.validators';

const userService = new UserService();

const handler = async (req: LambdaRequest<any> & { validatedUpdateRecentInvite?: { patientId: string; email?: boolean; sms?: boolean } }) => {
  const { patientId, email, sms } = req.validatedUpdateRecentInvite!;
  const userId = req.context.user?.userId ?? '';
  const organizationId = req.context.user?.organizationId ?? '';
  const { correlationId } = req.context;
  return userService.updateRecentInvite(userId, organizationId, patientId, { email, sms }, correlationId);
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateRecentInvite,
});
