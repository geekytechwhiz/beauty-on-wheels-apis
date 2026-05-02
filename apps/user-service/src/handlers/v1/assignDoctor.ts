import {   withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateAssignDoctor } from '../../validation/request.validators';

const userService = new UserService();

interface Body {
  organizationId: string;
  sender: {
    userId: string;
    name?: string;
    email?: string;
    userType?: string;
    presenceStatus?: string;
  };
  receiver: {
    userId: string;
    name?: string;
    email?: string;
    profileImage?: string;
    userType?: string;
    presenceStatus?: string;
  };
  isReferred?: boolean;
}
 
const assignDoctorHandler = async (
  req: LambdaRequest<Record<string, unknown>, Body>,
) => {
  const body = req.body!;
  const { organizationId, sender, receiver, isReferred } = body;
  const { correlationId } = req.context;
  await userService.assignDoctor(
    organizationId,
    sender,
    receiver,
    correlationId,
    isReferred ?? false,
  );
  return { message: 'Patient assigned to doctor successfully!' };
};

export const handler =   withApiHandler(
  {
    operation: 'assignDoctor',
    validator: (req) => validateAssignDoctor(req as any),
  },
  async (req) => {
   

    const result = await (assignDoctorHandler as any)(req);

    return result
  },
);
