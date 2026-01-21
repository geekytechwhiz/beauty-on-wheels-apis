import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getUser } from './httpHandler';

// This handler only creates USER_DETAILS for a user (no invite, no mapping)
export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return getUser(event, context);
};