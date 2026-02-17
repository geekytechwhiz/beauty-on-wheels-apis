import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { listScheduleExclusions } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return listScheduleExclusions(event, context);
};
