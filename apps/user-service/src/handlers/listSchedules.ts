import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { listSchedules } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return listSchedules(event, context);
};
