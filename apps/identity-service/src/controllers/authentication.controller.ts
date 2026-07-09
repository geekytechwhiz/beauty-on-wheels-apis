import { LambdaRequest } from '@api-hub/utils';
import { AuthenticationService } from '@api-hub/authentication-core';

export class AuthenticationController {
  constructor(private readonly authenticationService: AuthenticationService) {}

  async handleRegister(req: LambdaRequest) {
    const command = req.body;

    return this.authenticationService.createSession(command);
  }
}

export const getAuthenticationHttpController = () => {
  return new AuthenticationController(new AuthenticationService());
};
