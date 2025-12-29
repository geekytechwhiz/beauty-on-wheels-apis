import { CognitoIdentityProviderClient, AdminGetUserCommand, AdminCreateUserCommand } from '@aws-sdk/client-cognito-identity-provider';

export class CognitoService {
  private client: CognitoIdentityProviderClient;
  private userPoolId: string;

  constructor(region: string, userPoolId: string) {
    this.client = new CognitoIdentityProviderClient({ region });
    this.userPoolId = userPoolId;
  }

  async userExists(email: string): Promise<boolean> {
    try {
      const cmd = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
      });
      await this.client.send(cmd);
      return true;
    } catch {
      return false;
    }
  }

  async createUser(email: string): Promise<void> {
    const cmd = new AdminCreateUserCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      MessageAction: 'SUPPRESS',
    });
    await this.client.send(cmd);
  }
}
