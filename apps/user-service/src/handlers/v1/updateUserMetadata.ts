import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateUpdateUserMetadata } from '../../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const userService = new UserService();

interface Params {
  userId: string;
}

const handler = async (req: LambdaRequest<Params> & { validatedUpdateMetadata?: { metadata: Record<string, unknown> } }) => {
  const userId = req.pathParameters?.userId;
  const { metadata } = req.validatedUpdateMetadata!;
  return userService.updateUserMetadata(userId as string, metadata);
};

export const main =   withApiHandler(
          {
            operation: 'updateUserMetadata',
            validator: (req) => validateUpdateUserMetadata(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
