import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getSchedule } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return getSchedule(event, context);
};
