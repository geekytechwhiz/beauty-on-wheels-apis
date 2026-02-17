import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { updateSchedule } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return updateSchedule(event, context);
};
