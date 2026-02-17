import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { deleteScheduleExclusions } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return deleteScheduleExclusions(event, context);
};
