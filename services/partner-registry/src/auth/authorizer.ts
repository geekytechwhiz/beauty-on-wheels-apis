import type { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';

/**
 * Lambda token authorizer for partner-registry write operations (G5/G6).
 * Validates API key from Authorization header or x-api-key.
 * Set PARTNER_REGISTRY_API_KEY to enforce; if unset, allows all (dev).
 */
export function main(event: APIGatewayTokenAuthorizerEvent): APIGatewayAuthorizerResult {
  const configuredKey = process.env.PARTNER_REGISTRY_API_KEY;
  const token = (event.authorizationToken ?? '').replace(/^Bearer\s+/i, '').trim();
  const methodArn = event.methodArn;

  if (!configuredKey) {
    return allowPolicy('anonymous', methodArn);
  }

  if (token && token === configuredKey) {
    return allowPolicy('api-key', methodArn);
  }

  return denyPolicy(methodArn);
}

function allowPolicy(principalId: string, methodArn: string): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: methodArn,
        },
      ],
    },
  };
}

function denyPolicy(methodArn: string): APIGatewayAuthorizerResult {
  return {
    principalId: 'unauthorized',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Deny',
          Resource: methodArn,
        },
      ],
    },
  };
}
