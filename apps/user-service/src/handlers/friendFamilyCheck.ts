import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { friendFamilyCheck } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return friendFamilyCheck(event, context);
};
