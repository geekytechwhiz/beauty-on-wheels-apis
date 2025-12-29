import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { listUserOrganizations } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return listUserOrganizations(event, context);
};
