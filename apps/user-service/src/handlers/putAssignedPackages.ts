import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { putAssignedPackages } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return putAssignedPackages(event, context);
};
