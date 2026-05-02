import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

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

  let pathUserId = (req.pathParameters?.userId || '').trim();
  let pathOrganizationId = (req.pathParameters?.organizationId || '').trim();
  if(!pathUserId){
    pathUserId =userContext?.userId as string;
  }
  if(!pathOrganizationId)
    {
    pathOrganizationId=userContext?.organizationId as string;
  }

  return userService.getUserWithOrganizationDetails(
    pathUserId as string,
    pathOrganizationId as string,
    userContext?.userId as string | undefined, //loged in user id
    undefined, // default profile
    userType,
    req.context?.authHeader as string
  );
};

export const main =   withApiHandler(
          {
            operation: 'getUserOrganization',
            
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );