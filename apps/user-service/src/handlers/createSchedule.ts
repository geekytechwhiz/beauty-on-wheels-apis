import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createSchedule } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return createSchedule(event, context);
};
