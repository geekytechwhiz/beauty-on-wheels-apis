import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { friendFamilyFetch } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return friendFamilyFetch(event, context);
};
