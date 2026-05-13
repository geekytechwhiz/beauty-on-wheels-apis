/**
 * Local-only HTTP handler for testing the authorizer with serverless-offline.
 * POST body = APIGatewayTokenAuthorizerEvent (JSON).
 * Response = authorizer result (Allow/Deny policy) or 403 with error.
 */

import type { APIGatewayProxyevent: any, APIGatewayProxyResult } from 'aws-lambda';
import type { APIGatewayTokenAuthorizerEvent } from 'aws-lambda';
import { main } from './handler';

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const body = event.body;
  if (!body) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing body (expected authorizer event)' }),
    };
  }

  let authorizerEvent: APIGatewayTokenAuthorizerEvent;
  try {
    authorizerEvent = JSON.parse(body) as APIGatewayTokenAuthorizerEvent;
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  if (!authorizerEvent.authorizationToken || !authorizerEvent.methodArn) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Body must include authorizationToken and methodArn',
      }),
    };
  }

  try {
    const result = await main(authorizerEvent);
    const isAllow =
      result.policyDocument?.Statement?.[0]?.Effect === 'Allow';
    return {
      statusCode: isAllow ? 200 : 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Authorizer failed',
        policyDocument: null,
      }),
    };
  }
}
