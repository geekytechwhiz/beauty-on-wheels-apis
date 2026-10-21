/* eslint-disable mvrx/no-controller-business-logic */
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
} from 'aws-lambda';
import {
  DynamoDbAuthUserDirectory,
  evaluateApiGatewayAuthorizer,
} from '@api-hub/authentication-core';

let directory: DynamoDbAuthUserDirectory | undefined;

function getDirectory(): DynamoDbAuthUserDirectory {
  if (!directory) {
    directory = new DynamoDbAuthUserDirectory();
  }
  return directory;
}

/**
 * Cognito access tokens only. When User Service provisioning is linked,
 * `context.userId` is that verified application user. Cognito `sub` is never
 * copied into it. An in-progress, failed, or unreadable link does not Allow.
 */
export const handleAuthorize = async (
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  return evaluateApiGatewayAuthorizer(event, {
    userDirectory: getDirectory(),
    requireApplicationUser: true,
    expectedTokenUse: 'access',
  });
};
