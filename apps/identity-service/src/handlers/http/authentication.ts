import { withApiHandler } from '@api-hub/middleware';
import { getAuthenticationHttpController } from '../../controllers/authentication.controller';

import { LambdaRequest } from '@api-hub/utils';
import {
  validateLoginRequest,
  validateLogoutRequest,
  validateRefreshTokenRequest,
  validateRegisterRequest,
  validateVerifyOtpRequest,
} from '../../validators/register.validator';

const c = getAuthenticationHttpController();

export const handleRegister = withApiHandler(
  {
    operation: 'authentication.register',
    validator: (req: LambdaRequest) => {
      validateRegisterRequest(req);
    },
  },
  async (req: LambdaRequest) => c.handleRegister(req),
);

export const handleLogin = withApiHandler(
  {
    operation: 'authentication.login',
    validator: (req: LambdaRequest) => {
      validateLoginRequest(req);
    },
  },
  async (req: LambdaRequest) => c.handleLogin(req),
);

export const handleLogout = withApiHandler(
  {
    operation: 'authentication.logout',
    validator: (req: LambdaRequest) => {
      validateLogoutRequest(req);
    },
  },
  async (req: LambdaRequest) => c.handleLogout(req),
);

export const handleRefreshToken = withApiHandler(
  {
    operation: 'authentication.refreshToken',
    validator: (req: LambdaRequest) => {
      validateRefreshTokenRequest(req);
    },
  },
  async (req: LambdaRequest) => c.handleRefreshToken(req),
);

export const handleVerifyOTP = withApiHandler(
  {
    operation: 'authentication.verifyOTP',
    validator: (req: LambdaRequest) => {
      validateVerifyOtpRequest(req);
    },
  },
  async (req: LambdaRequest) => c.handleRverifyOTP(req),
);
