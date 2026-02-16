import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { setLogoutRequired } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return setLogoutRequired(event, context);
};
