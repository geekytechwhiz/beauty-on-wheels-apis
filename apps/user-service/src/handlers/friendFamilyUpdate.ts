import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { friendFamilyUpdate } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return friendFamilyUpdate(event, context);
};
