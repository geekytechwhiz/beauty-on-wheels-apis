import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { getEmailVerificationController } from '../controllers/email-verification.controller';
import { validateEmailVerificationRequest } from '../schemas/email-verification.schema';
import { withVendorApiHandler } from './with-vendor-handler';

const controller = getEmailVerificationController();

// A bearer link is the credential for this route; it intentionally has no
// Cognito authorizer. Do not resolve a canonical user here.
export const handleVerifyVendorEmail = withApiHandler(
  { operation: 'verifyvendoremail', validator: validateEmailVerificationRequest },
  async (request: LambdaRequest) => controller.verify(request),
);

export const handleResendVendorEmailVerification = withVendorApiHandler(
  { operation: 'resendvendoremailverification' },
  async (request: LambdaRequest) => controller.resend(request),
);
