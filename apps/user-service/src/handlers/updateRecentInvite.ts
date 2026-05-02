import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUpdateRecentInvite } from '../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const userService = new UserService();

const handler = async (req: LambdaRequest<any> & { validatedUpdateRecentInvite?: { patientId: string; email?: boolean; sms?: boolean } }) => {
  const { patientId, email, sms } = req.validatedUpdateRecentInvite!;
  const userId = req.context.userContext?.userId ?? '';
  const organizationId = req.context.userContext?.organizationId ?? '';
  const { correlationId } = req.context;
  return userService.updateRecentInvite(userId, organizationId, patientId, { email, sms }, correlationId);
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateRecentInvite,
});
