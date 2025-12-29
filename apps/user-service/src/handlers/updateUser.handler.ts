import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { updateUser } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return updateUser(event, context);
};
