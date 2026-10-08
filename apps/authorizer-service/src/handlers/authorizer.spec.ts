import type { APIGatewayTokenAuthorizerEvent } from 'aws-lambda';
import { evaluateApiGatewayAuthorizer } from '@api-hub/authentication-core';

import { handleAuthorize } from './authorizer';

jest.mock('@api-hub/authentication-core', () => ({
  DynamoDbAuthUserDirectory: jest.fn().mockImplementation(() => ({})),
  evaluateApiGatewayAuthorizer: jest.fn(),
}));

const evaluateMock = evaluateApiGatewayAuthorizer as jest.MockedFunction<
  typeof evaluateApiGatewayAuthorizer
>;

const METHOD_ARN =
  'arn:aws:execute-api:us-east-1:123:api/dev/GET/vendors';

describe('handleAuthorize', () => {
  beforeEach(() => {
    evaluateMock.mockReset();
  });

  it('returns the shared authorizer IAM policy', async () => {
    const policy = {
      principalId: 'cognito-sub-1',
      policyDocument: {
        Version: '2012-10-17' as const,
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow' as const,
            Resource: 'arn:aws:execute-api:us-east-1:123:api/dev/*',
          },
        ],
      },
      context: {
        identityId: 'cognito-sub-1',
        userId: 'u-1',
        roles: '["vendor"]',
        permissions: '["vendor:read"]',
      },
    };
    evaluateMock.mockResolvedValue(policy);

    const event: APIGatewayTokenAuthorizerEvent = {
      type: 'TOKEN',
      methodArn: METHOD_ARN,
      authorizationToken: 'Bearer token',
    };

    await expect(handleAuthorize(event)).resolves.toEqual(policy);
    expect(evaluateMock).toHaveBeenCalledWith(event, {
      userDirectory: expect.any(Object),
      requireApplicationUser: true,
      expectedTokenUse: 'access',
    });
  });
});
