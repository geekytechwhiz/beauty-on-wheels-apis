import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

import type { CognitoAdmin } from './compensation';

export type BootstrapCognito = CognitoAdmin & {
  probeExists: (destination: string) => Promise<boolean | 'unknown'>;
};

/**
 * Operator-side Cognito helpers for bootstrap ownership / compensation.
 * Uses the AWS credential chain (IAM). Does not require the app client secret.
 */
export function createBootstrapCognito(input: {
  region: string;
  userPoolId: string;
}): BootstrapCognito {
  const client = new CognitoIdentityProviderClient({ region: input.region });

  async function findUsername(destination: string): Promise<string | null> {
    const normalized = destination.trim();
    const filter = normalized.includes('@')
      ? `email = "${normalized.replace(/"/g, '')}"`
      : `phone_number = "${normalized.replace(/"/g, '')}"`;

    const result = await client.send(
      new ListUsersCommand({
        UserPoolId: input.userPoolId,
        Filter: filter,
        Limit: 1,
      }),
    );
    return result.Users?.[0]?.Username ?? null;
  }

  return {
    async probeExists(destination: string): Promise<boolean | 'unknown'> {
      try {
        return Boolean(await findUsername(destination));
      } catch {
        return 'unknown';
      }
    },

    async userExists(usernameOrDestination: string): Promise<boolean> {
      const username = await findUsername(usernameOrDestination);
      if (username) {
        return true;
      }
      // Compensation may pass a Cognito username directly.
      try {
        const result = await client.send(
          new ListUsersCommand({
            UserPoolId: input.userPoolId,
            Filter: `username = "${usernameOrDestination.replace(/"/g, '')}"`,
            Limit: 1,
          }),
        );
        return Boolean(result.Users?.[0]?.Username);
      } catch {
        return false;
      }
    },

    async deleteUser(username: string): Promise<void> {
      await client.send(
        new AdminDeleteUserCommand({
          UserPoolId: input.userPoolId,
          Username: username,
        }),
      );
    },
  };
}
