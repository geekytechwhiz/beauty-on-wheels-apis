import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { friendFamilyDelete } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return friendFamilyDelete(event, context);
};
