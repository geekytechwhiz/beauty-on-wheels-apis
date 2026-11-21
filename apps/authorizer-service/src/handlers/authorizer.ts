/* eslint-disable mvrx/no-controller-business-logic */
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
} from 'aws-lambda';
import {
  DynamoDbAuthUserDirectory,
  evaluateApiGatewayAuthorizer,
  readConfiguredInternalServiceToken,
} from '@api-hub/authentication-core';

let directory: DynamoDbAuthUserDirectory | undefined;

const IDENTITY_SELF_ROUTES = new Set([
  'GET/me',
  'GET/identity/me/provisioning-status',
]);

/**
 * An identity is authenticated before its asynchronous application-user link
 * exists.  Only the Identity service's self/profile routes may be called in
 * that interval; every other protected route still requires that link.
 */
export function requiresApplicationUser(methodArn: string): boolean {
  const request = methodArn.split('/').slice(2).join('/');
  return !IDENTITY_SELF_ROUTES.has(request);
}

function getDirectory(): DynamoDbAuthUserDirectory {
  if (!directory) {
    directory = new DynamoDbAuthUserDirectory();
  }
  return directory;
}

/**
 * Cognito access tokens, or the platform internal service token from SSM.
 * When User Service provisioning is linked, `context.userId` is that verified
 * application user. Cognito `sub` is never copied into it. An in-progress,
 * failed, or unreadable link does not Allow. Internal token callers receive
 * an INTERNAL principal with no application userId.
 */
export const handleAuthorize = async (
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  return evaluateApiGatewayAuthorizer(event, {
    userDirectory: getDirectory(),
    requireApplicationUser: requiresApplicationUser(event.methodArn),
    expectedTokenUse: 'access',
    internalServiceToken: readConfiguredInternalServiceToken(),
  });
};
