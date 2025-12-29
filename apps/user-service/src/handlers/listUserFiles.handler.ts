import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { listUserFiles } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return listUserFiles(event, context);
};
