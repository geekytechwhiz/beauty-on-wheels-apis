import { withLambdaHandler, LambdaRequest, validateUserOrganizationRequest } from '@api-hub/utils';
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

  const {   defaultProfile, userType,   } = req.params;
  const { userContext } = req.context;
  const userId = req.pathParameters?.userId;
  const organizationId = req.pathParameters?.organizationId; 
  return userService.getUserWithOrganizationDetails(
    userId as string,
    organizationId as string,
    defaultProfile,
    userType,
    userContext?.authHeader as string
  );
};

export const main = withLambdaHandler(handler);