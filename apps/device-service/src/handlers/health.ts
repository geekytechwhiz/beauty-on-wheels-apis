import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, APIGatewayProxyEvent, Context } from 'aws-lambda';

const healthImpl: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent, _context?: Context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'OK' }),
  };
};

export const handler = withStandardApiGatewayPipeline('device.health', healthImpl, { serviceName: 'device-service' });
