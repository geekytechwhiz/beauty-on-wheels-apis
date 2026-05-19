import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';

const userService = new UserService();

interface Params {
  userId?: string;
  organizationId?: string;
}

const handler = async (req: LambdaRequest<Params> & { validatedAssignedPackages?: { assignedPackages: any[]; assignedPackagesName: string[] } }) => {
  const userId= req.pathParameters?.userId;
  const organizationId = req.pathParameters?.organizationId; 
  const { correlationId } = req.context;
  const { assignedPackages, assignedPackagesName } = (req as any).validatedAssignedPackages;
  await userService.updateUser(userId as string, organizationId as string, { assignedPackages, assignedPackagesName }, correlationId);
  return { success: true };
};

export const main =   withApiHandler(
          {
            operation: 'putAssignedPackages',
            
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
