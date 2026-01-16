import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { listOrganizationUsers } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return listOrganizationUsers(event, context);
};

