import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { deleteUser } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return deleteUser(event, context);
};
