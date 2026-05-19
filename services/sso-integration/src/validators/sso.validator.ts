import { APIGatewayProxyEvent } from 'aws-lambda';
import { SSOError } from '../types/errors/sso-error';

const TOKEN_MIN_LENGTH = 10;
const TOKEN_MAX_LENGTH = 4096;

export function extractLaunchParams(
  event: APIGatewayProxyEvent,  
) {
  let token: string | undefined;

  
  if (event.httpMethod === 'GET') {
    token = event.queryStringParameters?.token;
  }

  if (event.httpMethod === 'POST') {
    if (!event.body) throw SSOError.invalidRequest('Request body required');

    const parsed = JSON.parse(event.body);
    token = parsed.token;
  }

  if (!token) throw SSOError.invalidToken('Missing token');

  if (token.length < TOKEN_MIN_LENGTH)
    throw SSOError.invalidToken('Token too short');

  if (token.length > TOKEN_MAX_LENGTH)
    throw SSOError.invalidToken('Token too long');

  return { token };
}
