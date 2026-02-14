import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { friendFamilySearch } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return friendFamilySearch(event, context);
};
