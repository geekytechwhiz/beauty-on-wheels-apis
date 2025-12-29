import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { assignUserToOrganization } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return assignUserToOrganization(event, context);
};
