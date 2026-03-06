import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service'; 

const userService = new UserService();

interface Params {
  userId: string;
  organizationId: string;
  defaultProfile?: string;
  userType?: string;
}

const handler = async (
  req: LambdaRequest<Params, any, Record<string, any>>
) => {
  const {   userType } = req.params;
  const { userContext } = req.context;

  const pathUserId = (req.pathParameters?.userId || '').trim();
  const pathOrganizationId = (req.pathParameters?.organizationId || '').trim();
 

  return userService.getUserWithOrganizationDetails(
    pathUserId as string,
    pathOrganizationId as string,
    userContext?.userId as string | undefined,
    userContext?.userId,  // loged user id
    userType,
    userContext?.authHeader as string
  );
};

export const main = withLambdaHandler(handler);