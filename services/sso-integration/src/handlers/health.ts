/**
 * Health check endpoint
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { successResponse } from '../utils/response';

export async function handler(
  _event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> {
  return successResponse({
    status: 'healthy',
    service: 'myvitalrx-sso',
    timestamp: new Date().toISOString(),
  });
}
