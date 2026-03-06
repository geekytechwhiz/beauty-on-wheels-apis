import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateUserOrganizationRequest, validateAssignedPackages } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  userId?: string;
  organizationId?: string;
}

const handler = async (req: LambdaRequest<Params> & { validatedAssignedPackages?: { assignedPackages: any[]; assignedPackagesName: string[] } }) => {
  const userId = req.params.userId ?? req.context.userContext?.userId!;
  const organizationId = req.params.organizationId ?? req.context.userContext?.organizationId!;
  const { correlationId } = req.context;
  const { assignedPackages, assignedPackagesName } = (req as any).validatedAssignedPackages;
  await userService.updateUser(userId, organizationId, { assignedPackages, assignedPackagesName }, correlationId);
  return { success: true };
};

export const main = withLambdaHandler(handler, {
  validator: (req: any) => {
    validateUserOrganizationRequest(req);
    validateAssignedPackages(req);
  },
});
