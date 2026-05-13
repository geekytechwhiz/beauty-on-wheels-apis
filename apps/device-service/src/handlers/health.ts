import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, APIGatewayProxyevent: any, Context } from 'aws-lambda';

const healthImpl: any = async (event: APIGatewayProxyevent: any, _context?: Context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'OK' }),
  };
};

export const handler = withStandardApiGatewayPipeline('device.health', healthImpl, { serviceName: 'device-service' });
