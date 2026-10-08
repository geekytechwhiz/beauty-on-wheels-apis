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

export const handleAuthorize = async (
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  return evaluateApiGatewayAuthorizer(event, {
    userDirectory: getDirectory(),
    requireApplicationUser: true,
    expectedTokenUse: 'access',
  });
};
