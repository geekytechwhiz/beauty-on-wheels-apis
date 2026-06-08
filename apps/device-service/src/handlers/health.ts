import { withApiHandler } from '@api-hub/middleware';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

const healthImpl: any = async (event: APIGatewayProxyEvent, _context?: Context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'OK' }),
  };
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.health' }, healthImpl);
