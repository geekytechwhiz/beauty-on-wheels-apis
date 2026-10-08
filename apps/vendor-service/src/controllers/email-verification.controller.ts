import { LambdaRequest } from '@api-hub/utils';
import { EmailVerificationService, getEmailVerificationService } from '../services/email-verification.service';

export class EmailVerificationController {
  constructor(private readonly service: EmailVerificationService = getEmailVerificationService()) {}

  verify(request: LambdaRequest) { return this.service.verify(request); }
  resend(request: LambdaRequest) { return this.service.resend(request); }
}

let controller: EmailVerificationController;
export function getEmailVerificationController() {
  if (!controller) controller = new EmailVerificationController();
  return controller;
}
