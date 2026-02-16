import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getUser } from './httpHandler';

/** Returns user details (user + org + transformed response). Delegates to httpHandler.getUser. */
export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return getUser(event, context);
};