import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { updateUserMetadata } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return updateUserMetadata(event, context);
};
