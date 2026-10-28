import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '@api-hub/utils';

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    ...buildCorsHeaders(event),
  },
  body: JSON.stringify({ status: 'UP' }),
});
