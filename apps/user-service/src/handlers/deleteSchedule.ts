import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { deleteSchedule } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return deleteSchedule(event, context);
};
