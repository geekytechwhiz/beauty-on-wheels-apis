import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getAuthenticationController } from '../controllers/authentication.controller';

import {
  validateLoginRequest,
  validateRefreshTokenRequest,
  validateChangePasswordRequest,
} from '../schemas/authentication.schema';

const controller = getAuthenticationController();

export const login = withApiHandler(
  {
    operation: 'postlogin',
    validator: (request: LambdaRequest) => {
      validateLoginRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handlePostlogin(request),
);

export const refreshToken = withApiHandler(
  {
    operation: 'postrefreshtoken',
    validator: (request: LambdaRequest) => {
      validateRefreshTokenRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handlePostrefreshtoken(request),
);

export const logout = withApiHandler(
  {
    operation: 'postlogout',
  },
  async (request: LambdaRequest) => controller.handlePostlogout(request),
);

export const changePassword = withApiHandler(
  {
    operation: 'postchangepassword',
    validator: (request: LambdaRequest) => {
      validateChangePasswordRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handlePostchangepassword(request),
);
